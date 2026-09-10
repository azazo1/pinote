// 更新服务: 把状态机, 发布查询, 下载校验与安装串起来, 对外只暴露快照与命令.
//
// 这里不直接依赖 Electron 的窗口与通知 API, 由 main.mjs 注入, 便于单独验证状态流转.

import { normalizeVersion, isFakeBuildVersion, isNewerVersion } from "./version.mjs";
import { platformSupport, assetNameCandidates, selectAsset, UPDATE_ASSET_APP } from "./update/assets.mjs";
import { DEFAULT_UPDATE_REPO, DEFAULT_API_BASE, fetchLatestRelease } from "./update/release-query.mjs";
import { createHttpClient } from "./update/http.mjs";
import { downloadAsset, findChecksumsAsset, parseChecksums, pickDigest } from "./update/download.mjs";
import { applyUpdate, cleanupUpdateArtifacts, readApplyResult, updateDirectory } from "./update/install.mjs";
import { UPDATE_ERROR_KINDS, UpdateError, describeError } from "./update/errors.mjs";
import { UPDATE_STATES, createUpdateSnapshot, isUpdateBusy, reduceUpdate } from "./update/update-runtime.mjs";

export const SILENT_CHECK_DELAY_MS = 5_000;
export const PROGRESS_BROADCAST_INTERVAL_MS = 200;

export class UpdateService {
  #snapshot;
  #release = null;
  #asset = null;
  #checksumsAsset = null;
  #downloadController = null;
  #restartExecutable = null;
  #silentCheckTimer = null;
  #lastProgressAt = 0;
  #openReleasePage = () => {};

  constructor({
    store,
    userDataPath,
    currentVersion,
    repo = DEFAULT_UPDATE_REPO,
    apiBase = DEFAULT_API_BASE,
    execPath,
    packaged = true,
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    logger,
    notify = () => {},
    broadcast = () => {},
    requestQuit = () => {},
    restartApp = () => {},
    openArtifact = () => {},
    openReleasePage: openReleasePageCallback = () => {},
    createClient = createHttpClient,
    now = () => Date.now(),
  }) {
    this.store = store;
    this.userDataPath = userDataPath;
    this.currentVersion = currentVersion;
    this.repo = repo;
    this.apiBase = apiBase;
    this.execPath = execPath;
    this.packaged = packaged;
    this.platform = platform;
    this.arch = arch;
    this.env = env;
    this.log = logger;
    this.notify = notify;
    this.broadcast = broadcast;
    this.requestQuit = requestQuit;
    this.restartApp = restartApp;
    this.openArtifact = openArtifact;
    this.#openReleasePage = openReleasePageCallback;
    this.createClient = createClient;
    this.now = now;
    const preferences = store.getPreferences();
    this.#snapshot = createUpdateSnapshot({
      currentVersion,
      autoCheck: preferences.update.autoCheck,
      skippedVersion: preferences.update.skippedVersion,
      canAutoInstall: true,
      isFakeBuild: isFakeBuildVersion(currentVersion),
    });
  }

  initialize() {
    cleanupUpdateArtifacts({
      userDataPath: this.userDataPath,
      execPath: this.execPath,
      platform: this.platform,
      env: this.env,
      log: (message) => this.log.info(message),
    });
    const applyResult = readApplyResult(this.userDataPath);
    if (applyResult) {
      this.log.warn("上次更新未完成", { message: applyResult });
      this.#snapshot = reduceUpdate(this.#snapshot, { type: "apply-result", message: applyResult });
    }
    this.log.info("更新服务已启动", {
      currentVersion: this.currentVersion,
      autoCheck: this.#snapshot.autoCheck,
      fake: this.#snapshot.isFakeBuild,
    });
    this.#emit();
    if (this.#snapshot.autoCheck) {
      this.#silentCheckTimer = setTimeout(() => {
        this.#silentCheckTimer = null;
        void this.checkForUpdates({ manual: false });
      }, SILENT_CHECK_DELAY_MS);
    }
    return this.getState();
  }

  dispose() {
    clearTimeout(this.#silentCheckTimer);
    this.#silentCheckTimer = null;
    this.#downloadController?.abort();
    this.#downloadController = null;
  }

  getState() {
    return { ...this.#snapshot, progress: this.#snapshot.progress ? { ...this.#snapshot.progress } : null };
  }

  async checkForUpdates({ manual = false } = {}) {
    if (isUpdateBusy(this.#snapshot)) return this.getState();
    const support = platformSupport(this.platform, this.arch);
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "check-start", manual });
    // 上次更新失败的原因展示到用户下一次主动检查为止.
    if (manual) this.#snapshot = reduceUpdate(this.#snapshot, { type: "apply-result", message: null });
    this.#emit();
    if (!support) {
      this.#recordFailure(new UpdateError("当前平台没有可用的更新包", { kind: UPDATE_ERROR_KINDS.unsupported }), manual);
      return this.getState();
    }

    const client = this.createClient({
      onProxy: ({ url, proxy }) => this.log.debug("更新请求代理", { url, proxy }),
    });
    try {
      this.log.info("开始检查更新", { manual, repo: this.repo });
      const release = await fetchLatestRelease({ client, repo: this.repo, apiBase: this.apiBase });
      const updateAvailable = isNewerVersion(release.tagName, this.#snapshot.currentVersion);
      const candidates = assetNameCandidates({
        app: UPDATE_ASSET_APP,
        version: release.tagName,
        platform: support.platform,
        arch: support.arch,
        extension: support.extension,
      });
      const asset = selectAsset(release.assets, candidates);
      const checksumsAsset = findChecksumsAsset(release.assets);
      const skipped = normalizeVersion(release.tagName) === normalizeVersion(this.#snapshot.skippedVersion);

      if (updateAvailable && (!asset || !checksumsAsset)) {
        const missing = !asset ? candidates[0] ?? "当前平台的安装包" : "SHA256SUMS";
        this.#recordFailure(new UpdateError(`最新版本里没有找到 ${missing}`, { kind: UPDATE_ERROR_KINDS.notFound }), manual);
        return this.getState();
      }

      this.#release = release;
      this.#asset = asset;
      this.#checksumsAsset = checksumsAsset;
      this.#restartExecutable = null;
      this.#snapshot = reduceUpdate(this.#snapshot, {
        type: "check-result",
        release,
        asset,
        updateAvailable,
        manual,
        skipped,
      });
      this.log.info("检查更新完成", {
        manual,
        latestVersion: release.tagName,
        updateAvailable,
        skipped,
        asset: asset?.name ?? null,
      });
      this.#emit();
      if (updateAvailable && !skipped && !manual) this.#notifyAvailable(release);
    } catch (error) {
      this.#recordFailure(error, manual);
    }
    return this.getState();
  }

  async startDownload() {
    if (this.#snapshot.state !== UPDATE_STATES.available) return this.getState();
    if (!this.#asset || !this.#checksumsAsset) {
      await this.checkForUpdates({ manual: true });
      if (this.#snapshot.state !== UPDATE_STATES.available) return this.getState();
    }

    this.#lastProgressAt = 0;
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "download-start", total: this.#asset.size });
    this.#emit();
    const controller = new AbortController();
    this.#downloadController = controller;
    const client = this.createClient({
      onProxy: ({ url, proxy }) => this.log.debug("下载请求代理", { url, proxy }),
    });

    try {
      this.log.info("开始下载更新", { asset: this.#asset.name, size: this.#asset.size });
      const { text } = await client.getText(this.#checksumsAsset.url);
      const checksums = parseChecksums(text);
      if (!pickDigest(checksums, [this.#asset.name])) {
        throw new UpdateError(`下载清单里没有 ${this.#asset.name} 的校验值`, { kind: UPDATE_ERROR_KINDS.checksum });
      }
      const assetPath = (await downloadAsset({
        client,
        asset: this.#asset,
        checksums,
        updateDir: updateDirectory(this.userDataPath),
        onProgress: ({ received, total }) => this.#reportProgress(received, total),
        signal: controller.signal,
        log: (message) => this.log.debug(message, { asset: this.#asset.name }),
      })).filePath;

      this.log.info("更新下载完成, 开始安装");
      const result = await applyUpdate({
        platform: this.platform,
        execPath: this.execPath,
        env: this.env,
        packaged: this.packaged,
        userDataPath: this.userDataPath,
        archivePath: assetPath,
        version: this.#snapshot.latestVersion,
        log: (message) => this.log.info(message, { asset: this.#asset.name }),
      });
      this.#restartExecutable = result.executable ?? null;
      this.#snapshot = reduceUpdate(this.#snapshot, { type: "install-finished", result });
      this.#emit();
      this.log.info("更新安装处理完成", { state: result.state });
      if (result.state === "manual") this.openArtifact(result.artifactPath);
      if (result.state === "handed-off") this.requestQuit("update");
    } catch (error) {
      const described = describeError(error);
      if (described.kind === UPDATE_ERROR_KINDS.cancelled) {
        this.log.info("用户取消了更新下载");
        this.#snapshot = reduceUpdate(this.#snapshot, { type: "download-cancelled" });
      } else {
        this.log.error("更新下载或安装失败", { message: described.message, kind: described.kind });
        this.#snapshot = reduceUpdate(this.#snapshot, {
          type: "download-failed",
          error: { message: described.message, kind: described.kind },
        });
      }
      this.#emit();
    } finally {
      this.#downloadController = null;
    }
    return this.getState();
  }

  cancelDownload() {
    if (this.#snapshot.state !== UPDATE_STATES.downloading) return false;
    this.#downloadController?.abort();
    return true;
  }

  skipLatestVersion() {
    const version = this.#snapshot.latestVersion;
    if (!version) return this.getState();
    this.#savePreferences({ skippedVersion: normalizeVersion(version) });
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "skip-version", version: normalizeVersion(version) });
    this.log.info("已跳过此版本", { version });
    this.#emit();
    return this.getState();
  }

  setAutoCheck(enabled) {
    this.#savePreferences({ autoCheck: Boolean(enabled) });
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "settings", autoCheck: Boolean(enabled) });
    this.log.info("更新自动检查设置已更新", { autoCheck: Boolean(enabled) });
    this.#emit();
    return this.getState();
  }

  // 替换已经完成, 用户点击 "重启应用" 后由 main 负责释放单实例锁并拉起新进程.
  restartToApply() {
    if (this.#snapshot.state !== UPDATE_STATES.readyToRestart) return false;
    this.log.info("用户请求重启应用以完成更新");
    this.restartApp(this.#restartExecutable);
    return true;
  }

  openReleasePage() {
    const url = this.#snapshot.releaseUrl || `https://github.com/${this.repo}/releases`;
    this.#openReleasePage(url);
  }

  dismissApplyResult() {
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "apply-result", message: null });
    this.#emit();
  }

  #savePreferences(changes) {
    const current = this.store.getPreferences().update;
    this.store.updatePreferences({ update: { ...current, ...changes } });
  }

  #recordFailure(error, manual) {
    const described = describeError(error);
    const payload = { message: described.message, kind: described.kind };
    if (manual) this.log.warn("检查更新失败", payload);
    else this.log.debug("静默检查更新失败", payload);
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "check-failed", manual, error: payload });
    this.#emit();
  }

  #reportProgress(received, total) {
    if (this.#snapshot.state !== UPDATE_STATES.downloading) return;
    const at = this.now();
    const finished = Number.isFinite(total) && received >= total;
    if (!finished && at - this.#lastProgressAt < PROGRESS_BROADCAST_INTERVAL_MS) return;
    this.#lastProgressAt = at;
    this.#snapshot = reduceUpdate(this.#snapshot, { type: "download-progress", received, total });
    this.#emit();
  }

  #notifyAvailable(release) {
    const version = normalizeVersion(release.tagName);
    this.log.info("发现新版本", { version });
    this.notify({
      title: "Pinote 有新版本",
      body: `v${version} 已发布, 点击查看更新详情.`,
    });
  }

  #emit() {
    this.broadcast(this.getState());
  }
}

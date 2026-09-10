import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpdateService } from "./update-service.mjs";

const VERSION = "v0.9.0";
const ASSET_NAME = `pinote-0.9.0-linux-x86_64.tar.gz`;

let root;
let appDir;
let userData;
let archive;

function makeApp() {
  const dir = path.join(root, "pinote");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "pinote"), "#!/bin/sh\necho 0.5.0\n", { mode: 0o755 });
  return dir;
}

function makeArchive() {
  const payload = path.join(root, "payload");
  mkdirSync(payload, { recursive: true });
  writeFileSync(path.join(payload, "pinote"), "#!/bin/sh\necho 0.9.0\n", { mode: 0o755 });
  const file = path.join(root, ASSET_NAME);
  execFileSync("tar", ["-czf", file, "-C", payload, "."]);
  return file;
}

function checksumsFor(file, { wrong = false } = {}) {
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  const value = wrong ? "0".repeat(64) : digest;
  return `${value}  ${ASSET_NAME}\n`;
}

function fakeStore(preferences = {}) {
  const state = {
    update: { autoCheck: true, skippedVersion: "", ...preferences },
  };
  return {
    getPreferences: () => ({ ...state, update: { ...state.update } }),
    updatePreferences: (patch) => {
      if (patch.update) state.update = { ...state.update, ...patch.update };
    },
  };
}

function fakeClient({ checksums, body = null, failCheck = null }) {
  return () => ({
    async getText(url) {
      if (failCheck) throw failCheck;
      if (url.endsWith("SHA256SUMS")) return { text: checksums, status: 200, headers: {} };
      return {
        text: JSON.stringify({
          tag_name: VERSION,
          name: `Pinote ${VERSION}`,
          body: "本次更新内容",
          html_url: "https://example.com/releases/v0.9.0",
          assets: [
            { name: ASSET_NAME, browser_download_url: "https://example.com/a.tar.gz", size: null },
            { name: "SHA256SUMS", browser_download_url: "https://example.com/SHA256SUMS", size: null },
          ],
        }),
        status: 200,
        headers: {},
      };
    },
    async download(url, { filePath, append }) {
      writeFileSync(filePath, body ?? readFileSync(archive), { flag: append ? "a" : "w" });
      return { status: 200, received: readFileSync(archive).length, total: readFileSync(archive).length };
    },
  });
}

function createService(overrides = {}) {
  return new UpdateService({
    store: fakeStore(overrides.preferences),
    userDataPath: userData,
    currentVersion: "v0.5.0",
    execPath: path.join(appDir, "pinote"),
    packaged: true,
    platform: "linux",
    arch: "x64",
    env: {},
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
    notify: () => {},
    broadcast: () => {},
    requestQuit: () => {},
    createClient: fakeClient({ checksums: checksumsFor(archive) }),
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pinote-update-"));
  appDir = makeApp();
  userData = path.join(root, "userdata");
  archive = makeArchive();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("UpdateService", () => {
  it("检查到新版本后下载校验并完成目录替换", async () => {
    const service = createService();
    service.initialize();

    const checked = await service.checkForUpdates({ manual: true });
    expect(checked).toMatchObject({
      state: "available",
      latestVersion: VERSION,
      assetName: ASSET_NAME,
      releaseNotes: "本次更新内容",
      skipped: false,
    });

    const installed = await service.startDownload();
    expect(installed.state).toBe("ready-to-restart");
    expect(execFileSync(path.join(appDir, "pinote"), { encoding: "utf8" })).toContain("0.9.0");
    service.dispose();
  });

  it("校验和不匹配时报错并丢弃下载内容", async () => {
    const service = createService({
      createClient: fakeClient({ checksums: checksumsFor(archive, { wrong: true }) }),
    });
    service.initialize();
    await service.checkForUpdates({ manual: true });

    const state = await service.startDownload();
    expect(state.state).toBe("failed");
    expect(state.error.message).toContain("校验失败");
    expect(readFileSync(path.join(appDir, "pinote"), "utf8")).toContain("0.5.0");
    service.dispose();
  });

  it("静默检查失败只更新状态, 不打扰用户", async () => {
    const service = createService({
      createClient: fakeClient({ checksums: "", failCheck: new Error("网络不可用") }),
    });
    service.initialize();

    const state = await service.checkForUpdates({ manual: false });
    expect(state).toMatchObject({ state: "failed", manualCheck: false });
    expect(state.error.message).toContain("网络不可用");
    service.dispose();
  });

  it("跳过此版本后持久化, 再次检查仍显示已跳过", async () => {
    const store = fakeStore();
    const service = new UpdateService({
      store,
      userDataPath: userData,
      currentVersion: "v0.5.0",
      execPath: path.join(appDir, "pinote"),
      packaged: true,
      platform: "linux",
      arch: "x64",
      env: {},
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
      createClient: fakeClient({ checksums: checksumsFor(archive) }),
    });
    service.initialize();
    await service.checkForUpdates({ manual: true });

    expect(service.skipLatestVersion()).toMatchObject({ state: "up-to-date", skipped: true });
    expect(store.getPreferences().update.skippedVersion).toBe("0.9.0");

    const again = await service.checkForUpdates({ manual: true });
    expect(again).toMatchObject({ state: "available", skipped: true });
    service.dispose();
  });

  it("dev-build 永远不认为有可用更新", async () => {
    const service = createService({ currentVersion: "dev-build" });
    service.initialize();

    const state = await service.checkForUpdates({ manual: true });
    expect(state.state).toBe("up-to-date");
    service.dispose();
  });

  it("自动检查开启时安排启动静默检查, 关闭时不安排", () => {
    const service = createService();
    service.initialize();
    expect(service.getState().autoCheck).toBe(true);
    service.dispose();

    const disabled = createService({ preferences: { autoCheck: false } });
    disabled.initialize();
    expect(disabled.getState().autoCheck).toBe(false);
    expect(disabled.getState().state).toBe("idle");
    disabled.dispose();
  });

  it("状态变化时把快照发给 UI", async () => {
    const snapshots = [];
    const service = createService({
      broadcast: (state) => snapshots.push(state),
    });
    service.initialize();
    expect(snapshots.at(-1)).toMatchObject({ currentVersion: "v0.5.0", state: "idle" });

    await service.checkForUpdates({ manual: true });
    expect(snapshots.at(-1)).toMatchObject({
      state: "available",
      latestVersion: VERSION,
      currentVersion: "v0.5.0",
    });
    service.dispose();
  });

  it("打开当前版本的 Release 页", async () => {
    const opened = [];
    const service = createService({
      openReleasePage: (url) => opened.push(url),
    });
    service.initialize();
    await service.checkForUpdates({ manual: true });
    service.openReleasePage();
    expect(opened).toEqual(["https://example.com/releases/v0.9.0"]);
    service.dispose();
  });
});

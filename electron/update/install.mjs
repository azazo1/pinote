// 更新安装: 判定当前运行形态, 选择替换策略, 并在失败时保证应用仍然可用.

import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { cp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { extractArchive } from "./archive.mjs";
import { UPDATE_ERROR_KINDS, UpdateError } from "./errors.mjs";
import { APPLY_SCRIPT_NAME as MAC_SCRIPT_NAME, buildMacApplyScript, startMacHandoff } from "./install-macos.mjs";
import { APPLY_SCRIPT_NAME as WINDOWS_SCRIPT_NAME, buildWindowsApplyScript, startWindowsHandoff } from "./install-windows.mjs";
import { normalizeVersion } from "../version.mjs";

export const UPDATE_DIRECTORY_NAME = "update";
export const APPLY_RESULT_FILE = "apply-update-result.txt";
export const APPLY_LOG_FILE = "apply-update.log";
export const BACKUP_SUFFIX = ".old";
export const MANUAL_INSTALL_MESSAGE = "当前运行方式无法自动替换, 已下载安装包, 请手动完成安装.";

export function updateDirectory(userDataPath) {
  return path.join(userDataPath, UPDATE_DIRECTORY_NAME);
}

// 判断当前可执行文件的运行形态, 替换策略据此决定.
//
// targetPath 是真正被替换的那个条目: macOS 是 .app 包本身, 其余平台是应用目录.
// 暂存与备份一律按 targetPath 的同级条目计算, 不能取 appDir 的父目录 --
// 对 macOS 而言 appDir 已经是 /Applications, 再往上取一层会落到只读的根卷.
export function resolveAppLayout({ execPath, platform = process.platform, env = process.env }) {
  if (platform === "darwin") {
    const matched = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
    if (matched) {
      return {
        kind: "macos-bundle",
        executable: execPath,
        bundlePath: matched[1],
        appDir: path.dirname(matched[1]),
        targetPath: matched[1],
      };
    }
    return {
      kind: "portable",
      executable: execPath,
      bundlePath: null,
      appDir: path.dirname(execPath),
      targetPath: execPath,
    };
  }
  if (platform === "linux" && env.APPIMAGE) {
    return {
      kind: "appimage",
      executable: execPath,
      appImagePath: env.APPIMAGE,
      appDir: path.dirname(env.APPIMAGE),
      targetPath: env.APPIMAGE,
    };
  }
  const appDir = path.dirname(execPath);
  return { kind: "portable-directory", executable: execPath, appDir, targetPath: appDir };
}

export function isDirectoryWritable(directory, access = accessSync) {
  try {
    access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveInstallPlan({ platform = process.platform, layout, directoryWritable }) {
  if (platform === "darwin") {
    return layout.kind === "macos-bundle"
      ? { strategy: "macos-handoff", appDir: layout.appDir, bundlePath: layout.bundlePath }
      : { strategy: "manual", reason: "当前不是从 .app 包运行, 无法自动替换应用包." };
  }
  if (layout.kind === "appimage") {
    return { strategy: "manual", reason: "AppImage 运行方式无法自动替换, 请下载便携版或手动替换 AppImage." };
  }
  if (!directoryWritable) {
    return { strategy: "manual", reason: "应用所在目录不可写, 请用安装包升级或手动解压替换." };
  }
  return {
    strategy: platform === "win32" ? "windows-handoff" : "linux-swap",
    appDir: layout.appDir,
    executable: layout.executable,
  };
}

// 暂存目录必须与替换目标同级同卷, 最后一步才能用 rename 就位.
function stagingPathFor(targetPath, version) {
  const name = `.${path.basename(targetPath)}.update-${normalizeVersion(version) || "latest"}`;
  return path.join(path.dirname(targetPath), name);
}

// 替换脚本会改名并删除这些路径, 生成脚本前先确认它们的形状符合预期:
// 任何一个退化成父目录本身, 都会在替换时把同级内容一起删掉.
export function assertSafeApplyPaths({ targetPath, stagingPath, backupPath }) {
  const parent = path.dirname(targetPath);
  const problems = [];
  if (stagingPath === targetPath || backupPath === targetPath) problems.push("暂存或备份路径与替换目标重合");
  if (path.dirname(stagingPath) !== parent) problems.push("暂存路径不在替换目标的同级目录");
  if (path.dirname(backupPath) !== parent) problems.push("备份路径不在替换目标的同级目录");
  if (backupPath !== `${targetPath}${BACKUP_SUFFIX}`) problems.push("备份路径命名不符合约定");
  if (!path.basename(stagingPath).startsWith(".")) problems.push("暂存路径应是同级目录下的隐藏条目");
  if (problems.length > 0) {
    throw new UpdateError(`替换路径不安全: ${problems.join(", ")}`, { kind: UPDATE_ERROR_KINDS.fileSystem });
  }
  return true;
}

// rename 允许把正在运行的可执行文件改名让位, 但跨文件系统时会失败 (EXDEV),
// 那时退回复制后删除源文件.
export async function moveDirectory({ from, to, rename: move = rename, copy = cp, log = () => {} }) {
  try {
    await move(from, to);
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    log(`跨文件系统移动 ${from}, 改为复制后删除`);
    await copy(from, to, { recursive: true, force: true });
    await rm(from, { recursive: true, force: true });
    return "copy";
  }
}

export async function swapApplicationDirectory({
  appDir,
  stagingDir,
  executableName = null,
  platform = process.platform,
  log = () => {},
  rename: move = rename,
  remove = rm,
  chmod = chmodSync,
}) {
  const backup = `${appDir}${BACKUP_SUFFIX}`;
  await remove(backup, { recursive: true, force: true });
  try {
    await moveDirectory({ from: appDir, to: backup, rename: move, log });
  } catch (error) {
    throw new UpdateError(`无法让位当前应用目录: ${error.message}`, { kind: UPDATE_ERROR_KINDS.fileSystem, cause: error });
  }
  try {
    const method = await moveDirectory({ from: stagingDir, to: appDir, rename: move, log });
    if (method === "copy") await remove(stagingDir, { recursive: true, force: true });
  } catch (error) {
    await moveDirectory({ from: backup, to: appDir, rename: move }).catch(() => {});
    throw new UpdateError(`替换应用目录失败, 已回滚: ${error.message}`, { kind: UPDATE_ERROR_KINDS.fileSystem, cause: error });
  }
  if (executableName && platform !== "win32") {
    try {
      chmod(path.join(appDir, executableName), 0o755);
    } catch (error) {
      log(`设置可执行权限失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  try {
    await remove(backup, { recursive: true, force: true });
  } catch {
    log("旧版本备份暂时无法删除, 留待下次启动清理");
  }
}

export function applyPaths({ userDataPath, targetPath, version }) {
  const directory = updateDirectory(userDataPath);
  mkdirSync(directory, { recursive: true });
  return {
    directory,
    staging: stagingPathFor(targetPath, version),
    backup: `${targetPath}${BACKUP_SUFFIX}`,
    log: path.join(directory, APPLY_LOG_FILE),
    result: path.join(directory, APPLY_RESULT_FILE),
  };
}

export async function applyUpdate({
  platform = process.platform,
  execPath,
  env = process.env,
  packaged = true,
  userDataPath,
  archivePath,
  version,
  log = () => {},
}) {
  const layout = resolveAppLayout({ execPath, platform, env });
  const directoryWritable = isDirectoryWritable(path.dirname(layout.targetPath));
  const plan = resolveInstallPlan({ platform, layout, directoryWritable });
  const paths = applyPaths({ userDataPath, targetPath: layout.targetPath, version });

  // 开发构建直接跑 electron 可执行文件, 替换它会破坏开发环境, 只提示不安装.
  if (!packaged) {
    const reason = "当前是开发构建, 不参与自动更新.";
    log(`跳过自动安装: ${reason}`);
    return { state: "manual", message: reason, artifactPath: archivePath };
  }

  if (plan.strategy === "manual") {
    log(`无法自动安装: ${plan.reason}`);
    return { state: "manual", message: plan.reason, artifactPath: archivePath };
  }

  // 从这里开始会真实改动磁盘, 先确认暂存与备份路径的形状.
  assertSafeApplyPaths({ targetPath: layout.targetPath, stagingPath: paths.staging, backupPath: paths.backup });

  if (plan.strategy === "macos-handoff") {
    const mountPath = path.join(paths.directory, `mount-${Date.now()}`);
    const script = buildMacApplyScript({
      pid: process.pid,
      bundlePath: layout.bundlePath,
      dmgPath: archivePath,
      stagingPath: paths.staging,
      backupPath: paths.backup,
      mountPath,
      logPath: paths.log,
      resultPath: paths.result,
    });
    startMacHandoff({ scriptPath: path.join(paths.directory, MAC_SCRIPT_NAME), script, logPath: paths.log });
    log("已交接给替换脚本, 应用将退出后完成替换");
    return {
      state: "handed-off",
      message: "正在退出并替换, 请勿手动关闭进程.",
      executable: layout.executable,
    };
  }

  await extractArchive({ archivePath, destination: paths.staging, platform });
  log("新版本已解包到暂存目录");

  if (plan.strategy === "windows-handoff") {
    const script = buildWindowsApplyScript({
      pid: process.pid,
      appDir: layout.appDir,
      exeName: path.basename(layout.executable),
      stagingPath: paths.staging,
      backupPath: paths.backup,
      logPath: paths.log,
      resultPath: paths.result,
    });
    startWindowsHandoff({ scriptPath: path.join(paths.directory, WINDOWS_SCRIPT_NAME), script, logPath: paths.log });
    log("已交接给替换脚本, 应用将退出后完成替换");
    return {
      state: "handed-off",
      message: "正在退出并替换, 请勿手动关闭进程.",
      executable: layout.executable,
    };
  }

  await swapApplicationDirectory({
    appDir: layout.appDir,
    stagingDir: paths.staging,
    executableName: path.basename(layout.executable),
    platform,
    log,
  });
  const executable = path.join(layout.appDir, path.basename(layout.executable));
  log("应用目录已替换, 等待重启");
  return { state: "ready-to-restart", message: "新版本已就绪, 重启后生效.", executable };
}

export function readApplyResult(userDataPath, { remove = unlinkSync } = {}) {
  const file = path.join(updateDirectory(userDataPath), APPLY_RESULT_FILE);
  if (!existsSync(file)) return null;
  let message = "";
  try {
    message = readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  } catch {
    message = "";
  }
  try {
    remove(file);
  } catch {
    // 文件被占用时留待下次启动再清理.
  }
  return message.length > 0 ? message : null;
}

function removeQuietly(target, remove = rmSync) {
  try {
    remove(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// 启动时清理上次更新留下的备份, 暂存目录, 挂载点与替换脚本; 日志与已下载归档保留.
export function cleanupUpdateArtifacts({
  userDataPath,
  execPath,
  platform = process.platform,
  env = process.env,
  list = readdirSync,
  exists = existsSync,
  remove = rmSync,
  stat = statSync,
  log = () => {},
}) {
  const layout = resolveAppLayout({ execPath, platform, env });
  const parent = path.dirname(layout.targetPath);
  const prefix = path.basename(layout.targetPath);
  removeQuietly(`${layout.targetPath}${BACKUP_SUFFIX}`, remove);

  let siblings = [];
  try {
    siblings = list(parent);
  } catch {
    siblings = [];
  }
  for (const entry of siblings) {
    if (!entry.startsWith(`${prefix}.update-`)) continue;
    removeQuietly(path.join(parent, entry), remove);
    log(`清理上次遗留的暂存目录 ${entry}`);
  }

  const directory = updateDirectory(userDataPath);
  if (!exists(directory)) return;
  let entries = [];
  try {
    entries = list(directory);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const target = path.join(directory, entry);
    if (entry === APPLY_RESULT_FILE || entry === APPLY_LOG_FILE) continue;
    if (entry.startsWith("mount-") || entry.startsWith(`${prefix}.update-`)) {
      removeQuietly(target, remove);
      continue;
    }
    if (entry === MAC_SCRIPT_NAME || entry === WINDOWS_SCRIPT_NAME) {
      removeQuietly(target, remove);
      continue;
    }
    if (entry.endsWith(".part")) {
      // 上次下载中断, 保留给续传使用.
      continue;
    }
    try {
      // 超过 30 天的归档不再保留, 避免更新目录持续膨胀.
      if (stat(target).mtimeMs < Date.now() - 30 * 24 * 60 * 60 * 1000) removeQuietly(target, remove);
    } catch {
      // 忽略统计失败的条目.
    }
  }
}

export function applyLogPath(userDataPath) {
  return path.join(updateDirectory(userDataPath), APPLY_LOG_FILE);
}

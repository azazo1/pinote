// 日志基础设施: 文件路径覆盖, 每日与单文件大小轮转, 留存数量限制, 未捕获异常落盘.
//
// env 覆盖:
// - PINOTE_LOG_FILE: 主日志文件完整路径 (默认 <userData>/logs/pinote.log).
// - PINOTE_LOG_LEVEL: error | warn | info | verbose | debug | silly (默认 info).
//
// just debug 会把这两个变量指向项目内的 target/pinote-debug/, 便于隔离排查.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import log from "electron-log/main.js";

export const DEFAULT_LOG_LEVEL = "info";
export const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;
export const KEEP_ARCHIVED_LOGS = 7;

const LOG_LEVELS = new Set(["error", "warn", "info", "verbose", "debug", "silly"]);
// electron-log 没有 trace, just debug 习惯注入 trace, 映射到最详细的 silly.
const LOG_LEVEL_ALIASES = new Map([["trace", "silly"]]);

export function parseLogLevel(value, fallback = DEFAULT_LOG_LEVEL) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const resolved = LOG_LEVEL_ALIASES.get(normalized) ?? normalized;
  return LOG_LEVELS.has(resolved) ? resolved : fallback;
}

export function resolveLogFile({ env = process.env, userDataPath }) {
  const override = env.PINOTE_LOG_FILE?.trim();
  return override && override.length > 0 ? override : path.join(userDataPath, "logs", "pinote.log");
}

export function dateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function archivePath(logFile, date = new Date(), { exists = existsSync } = {}) {
  const directory = path.dirname(logFile);
  const extension = path.extname(logFile);
  const stem = path.basename(logFile, extension);
  let candidate = path.join(directory, `${stem}.${dateStamp(date)}${extension}`);
  let index = 1;
  while (exists(candidate)) {
    candidate = path.join(directory, `${stem}.${dateStamp(date)}-${index}${extension}`);
    index += 1;
  }
  return candidate;
}

// 把当前日志文件挪到归档名, 并清理超过留存数量的旧归档.
export function archiveLogFile({
  logFile,
  date = new Date(),
  keep = KEEP_ARCHIVED_LOGS,
  rename = renameSync,
  exists = existsSync,
  list = readdirSync,
  remove = unlinkSync,
  stat = statSync,
}) {
  if (!exists(logFile)) return null;
  const target = archivePath(logFile, date, { exists });
  try {
    rename(logFile, target);
  } catch (error) {
    log.warn("归档日志文件失败", { logFile, message: error instanceof Error ? error.message : "未知错误" });
    return null;
  }
  pruneArchivedLogs({ logFile, keep, list, remove, stat });
  return target;
}

export function pruneArchivedLogs({ logFile, keep = KEEP_ARCHIVED_LOGS, list = readdirSync, remove = unlinkSync, stat = statSync }) {
  const directory = path.dirname(logFile);
  const extension = path.extname(logFile);
  const stem = path.basename(logFile, extension);
  const active = path.basename(logFile);
  let entries;
  try {
    entries = list(directory);
  } catch {
    return [];
  }
  const archived = entries
    .filter((entry) => entry !== active && entry.startsWith(`${stem}.`) && entry.endsWith(extension))
    .map((entry) => {
      const file = path.join(directory, entry);
      return { file, mtime: stat(file).mtimeMs };
    })
    .sort((left, right) => right.mtime - left.mtime);
  const removed = [];
  for (const entry of archived.slice(keep)) {
    try {
      remove(entry.file);
      removed.push(entry.file);
    } catch {
      // 文件被占用时静默留待下次清理.
    }
  }
  return removed;
}

// 启动时先把跨天的日志归档, 再接管日志级别与文件位置.
export function configureAppLogging({ userDataPath, env = process.env, now = new Date() } = {}) {
  const filePath = resolveLogFile({ env, userDataPath });
  const level = parseLogLevel(env.PINOTE_LOG_LEVEL);
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (existsSync(filePath) && dateStamp(statSync(filePath).mtime) !== dateStamp(now)) {
      archiveLogFile({ logFile: filePath, date: statSync(filePath).mtime });
    }
  } catch (error) {
    log.warn("准备日志文件失败", { filePath, message: error instanceof Error ? error.message : "未知错误" });
  }

  log.initialize();
  log.transports.file.resolvePathFn = () => filePath;
  log.transports.file.maxSize = MAX_LOG_FILE_BYTES;
  log.transports.file.archiveLogFn = (file) => {
    archiveLogFile({ logFile: file });
  };
  log.transports.file.level = level;
  // 终端保留 info 以上输出, 方便从命令行启动时直接观察.
  log.transports.console.level = level === "error" || level === "warn" ? level : "info";
  log.transports.console.format = "{h}:{i}:{s}.{ms} [{level}] {text}";
  return { filePath, level };
}

export function setLogLevel(level, { levelChange } = {}) {
  const next = parseLogLevel(level);
  log.transports.file.level = next;
  log.transports.console.level = next === "error" || next === "warn" ? next : "info";
  levelChange?.(next);
  return next;
}

export function installProcessErrorHandlers() {
  process.on("uncaughtException", (error) => {
    log.error("主进程未捕获异常", error);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("主进程未处理的 Promise 拒绝", reason instanceof Error ? reason : { reason: String(reason) });
  });
}

export function logRuntimeInfo({ app, version, logFile, level }) {
  const memory = process.getSystemMemoryInfo?.();
  log.info("运行环境", {
    app: app.getName(),
    version,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
    logFile,
    level,
    totalMemoryMb: memory ? Math.round(memory.total / 1024) : undefined,
  });
}

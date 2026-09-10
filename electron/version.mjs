// 运行时版本号的解析与比较.
//
// 版本号来源优先级:
// 1. 环境变量 PINOTE_BUILD_VERSION (测试与本地验证用, 例如把界面当成新版本来跑).
// 2. 打包产物中的 resources/build-version.json, 由 scripts/write-build-version.mjs 在
//    发布打包路径写入, 内容来自 scripts/build-version.sh 或 scripts/build-version.ps1.
// 3. 普通开发构建显示 dev-build, 永远不提示更新.
//
// 归一化规则: 去掉可选的前导 v, 截断 `-<commit>` 与 `^<commit>` 后缀, 便于和 release tag 比较.
// 显示时保留原始字符串, 让用户能看出当前构建落在哪个 commit 上.

import { readFileSync } from "node:fs";
import path from "node:path";

export const DEV_BUILD_VERSION = "dev-build";
export const FAKE_BUILD_VERSION = "0.0.0";

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT_SUFFIX_PATTERN = /[-^][0-9a-f]{7,40}$/;

export function normalizeVersion(value) {
  if (typeof value !== "string") return "";
  let version = value.trim();
  if (version.startsWith("v") || version.startsWith("V")) version = version.slice(1);
  version = version.replace(COMMIT_SUFFIX_PATTERN, "");
  return version.trim();
}

export function parseVersion(value) {
  const matched = SEMVER_PATTERN.exec(normalizeVersion(value));
  if (!matched) return null;
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4] ? matched[4].split(".") : [],
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

// 候选版本严格大于当前版本时才提示更新; 任何一方无法解析出 semver (含 dev-build) 都不提示.
export function isNewerVersion(candidate, current) {
  const result = compareVersions(candidate, current);
  return result === 1;
}

export function isDevBuildVersion(version) {
  return typeof version === "string" && version.trim() === DEV_BUILD_VERSION;
}

export function isFakeBuildVersion(version) {
  return normalizeVersion(version) === FAKE_BUILD_VERSION;
}

export function readEmbeddedVersion(resourcesPath, readFile = (file) => readFileSync(file, "utf8")) {
  if (!resourcesPath) return null;
  try {
    const parsed = JSON.parse(readFile(path.join(resourcesPath, "build-version.json")));
    const version = typeof parsed?.version === "string" ? parsed.version.trim() : "";
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

export function resolveRuntimeVersion({
  env = process.env,
  packaged = false,
  resourcesPath = null,
  appVersion = "0.0.0",
  readFile,
} = {}) {
  const override = env.PINOTE_BUILD_VERSION?.trim();
  if (override) return override;
  const embedded = readFile
    ? readEmbeddedVersion(resourcesPath, readFile)
    : readEmbeddedVersion(resourcesPath);
  if (embedded) return embedded;
  return packaged ? `v${appVersion}` : DEV_BUILD_VERSION;
}

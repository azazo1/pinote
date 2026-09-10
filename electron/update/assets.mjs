// Release 资产命名与匹配.
//
// 契约来自 create-github-release-flow skill: 归档命名为
// `<app>-<version>-<platform>-<arch>.<ext>`, 其中 platform ∈ macos | windows | linux,
// arch ∈ x86_64 | aarch64, ext 随平台为 dmg | zip | tar.gz, 同一个 release 必须存在
// SHA256SUMS 资产.
//
// 客户端构造候选名时同时接受带 v 与不带 v 的版本前缀, 两种发布习惯都能匹配上.

import { normalizeVersion } from "../version.mjs";

export const UPDATE_ASSET_APP = "pinote";

const PLATFORM_KEYS = { darwin: "macos", win32: "windows", linux: "linux" };
const ARCH_KEYS = { x64: "x86_64", arm64: "aarch64" };
const PLATFORM_EXTENSIONS = { macos: "dmg", windows: "zip", linux: "tar.gz" };

export function platformKey(platform = process.platform) {
  return PLATFORM_KEYS[platform] ?? null;
}

export function archKey(arch = process.arch) {
  return ARCH_KEYS[arch] ?? null;
}

export function archiveExtension(platform) {
  return PLATFORM_EXTENSIONS[platform] ?? null;
}

export function platformSupport(platform = process.platform, arch = process.arch) {
  const key = platformKey(platform);
  const architecture = archKey(arch);
  const extension = key ? archiveExtension(key) : null;
  if (!key || !architecture || !extension) return null;
  return { platform: key, arch: architecture, extension };
}

// 标准名优先, 其次兼容带 v 前缀的发布习惯.
export function assetNameCandidates({ app = UPDATE_ASSET_APP, version, platform, arch, extension }) {
  const normalized = normalizeVersion(version);
  if (!normalized || !platform || !arch || !extension) return [];
  return [
    `${app}-${normalized}-${platform}-${arch}.${extension}`,
    `${app}-v${normalized}-${platform}-${arch}.${extension}`,
  ];
}

export function selectAsset(assets, candidates) {
  const byName = new Map((assets ?? []).map((asset) => [asset.name, asset]));
  for (const candidate of candidates) {
    const asset = byName.get(candidate);
    if (asset) return asset;
  }
  return null;
}

// 发布信息查询: 读取最新 release, 解析资产列表.

import { UpdateError, UPDATE_ERROR_KINDS } from "./errors.mjs";

export const DEFAULT_UPDATE_REPO = "azazo1/pinote";
export const DEFAULT_API_BASE = "https://api.github.com";
export const GITHUB_ACCEPT = "application/vnd.github+json";

// PINOTE_UPDATE_REPO 与 PINOTE_UPDATE_API_BASE 用于本地验证更新流程 (指向测试服务或本地假服务),
// 也方便 fork 后指向自己的仓库, 不设置时使用正式地址.
export function resolveUpdateConfig(env = process.env) {
  const repo = env.PINOTE_UPDATE_REPO?.trim() || DEFAULT_UPDATE_REPO;
  const apiBase = (env.PINOTE_UPDATE_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
  return { repo, apiBase };
}

export function latestReleaseUrl(repo = DEFAULT_UPDATE_REPO, apiBase = DEFAULT_API_BASE) {
  return `${apiBase}/repos/${repo}/releases/latest`;
}

export function releasePageUrl(repo = DEFAULT_UPDATE_REPO) {
  return `https://github.com/${repo}/releases`;
}

export function releaseTagUrl(repo, tag) {
  return tag ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}` : releasePageUrl(repo);
}

export function parseLatestRelease(payload) {
  if (!payload || typeof payload !== "object" || typeof payload.tag_name !== "string") {
    throw new UpdateError("发布信息格式无法识别", { kind: UPDATE_ERROR_KINDS.unknown });
  }
  return {
    tagName: payload.tag_name,
    name: typeof payload.name === "string" ? payload.name : "",
    notes: typeof payload.body === "string" ? payload.body : "",
    htmlUrl: typeof payload.html_url === "string" ? payload.html_url : "",
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : "",
    assets: Array.isArray(payload.assets)
      ? payload.assets
        .filter((asset) => asset && typeof asset.name === "string" && typeof asset.browser_download_url === "string")
        .map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
          size: Number.isFinite(asset.size) ? asset.size : null,
        }))
      : [],
  };
}

export async function fetchLatestRelease({ client, repo = DEFAULT_UPDATE_REPO, apiBase = DEFAULT_API_BASE }) {
  const { text } = await client.getText(latestReleaseUrl(repo, apiBase), { accept: GITHUB_ACCEPT });
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new UpdateError("发布信息无法解析", { kind: UPDATE_ERROR_KINDS.unknown, cause: error });
  }
  return parseLatestRelease(payload);
}

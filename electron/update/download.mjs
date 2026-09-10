// 归档下载与 SHA256 校验.
//
// 流程: 先取 SHA256SUMS 里对应归档的期望摘要, 归档下载到 <data>/update/<name>.part,
// 支持断点续传, 下载完成后整文件计算 sha256 比对, 匹配才 rename 成正式文件名落盘.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { UPDATE_ERROR_KINDS, UpdateError } from "./errors.mjs";

export const CHECKSUMS_ASSET_NAME = "SHA256SUMS";

export function parseChecksums(text) {
  const checksums = new Map();
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const matched = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!matched) continue;
    checksums.set(matched[2].trim(), matched[1].toLowerCase());
  }
  return checksums;
}

export function pickDigest(checksums, candidates) {
  for (const candidate of candidates ?? []) {
    const digest = checksums.get(candidate);
    if (digest) return digest;
  }
  return null;
}

export function findChecksumsAsset(assets) {
  return (assets ?? []).find((asset) => asset.name === CHECKSUMS_ASSET_NAME) ?? null;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// `.part` 已经完整时直接校验, 避免再发一次必然得到 416 的 Range 请求.
export function resumeDecision({ partSize, total }) {
  if (!Number.isFinite(partSize) || partSize <= 0) return "restart";
  if (Number.isFinite(total) && total > 0 && partSize >= total) return "verify";
  return "resume";
}

function isRangeNotSatisfiable(error) {
  return error instanceof UpdateError && /\b416\b/.test(error.message);
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export async function downloadAsset({ client, asset, checksums, updateDir, onProgress, signal, log = () => {} }) {
  const expected = pickDigest(checksums, [asset.name]);
  if (!expected) {
    throw new UpdateError(`下载清单里没有 ${asset.name} 的校验值`, { kind: UPDATE_ERROR_KINDS.checksum });
  }

  await mkdir(updateDir, { recursive: true });
  const finalPath = path.join(updateDir, asset.name);
  const partPath = `${finalPath}.part`;

  const verify = async (filePath) => (await sha256File(filePath)) === expected;

  if (await fileSize(finalPath) > 0 && await verify(finalPath)) {
    log(`${asset.name} 已下载并通过校验`);
    return { filePath: finalPath, bytes: await fileSize(finalPath), reused: true };
  }
  await rm(finalPath, { force: true });

  const partSize = await fileSize(partPath);
  if (partSize > 0 && resumeDecision({ partSize, total: asset.size }) === "verify" && await verify(partPath)) {
    await rename(partPath, finalPath);
    log(`${asset.name} 的未完成下载其实已经完整, 直接采用`);
    return { filePath: finalPath, bytes: partSize, reused: true };
  }

  const download = async () => {
    if (partSize > 0) {
      log(`从 ${partSize} 字节处续传 ${asset.name}`);
      try {
        const result = await client.download(asset.url, {
          filePath: partPath,
          append: true,
          headers: { Range: `bytes=${partSize}-` },
          expectedStatuses: [200, 206],
          onProgress: ({ received, total }) => onProgress?.({
            received: partSize + received,
            total: total ? partSize + total : null,
          }),
          signal,
        });
        if (result.status === 206) return;
        log("服务器不支持断点续传, 重新开始下载");
      } catch (error) {
        if (!isRangeNotSatisfiable(error)) throw error;
        log(`续传起点已失效, 重新开始下载 ${asset.name}`);
      }
      await rm(partPath, { force: true });
    }
    await client.download(asset.url, {
      filePath: partPath,
      append: false,
      onProgress: ({ received, total }) => onProgress?.({ received, total }),
      signal,
    });
  };

  await download();

  if (!(await verify(partPath))) {
    await rm(partPath, { force: true });
    throw new UpdateError(`${asset.name} 校验失败, 已丢弃下载内容, 请重试`, { kind: UPDATE_ERROR_KINDS.checksum });
  }
  await rename(partPath, finalPath);
  const bytes = await fileSize(finalPath);
  log(`${asset.name} 下载完成并通过校验`);
  return { filePath: finalPath, bytes, reused: false };
}

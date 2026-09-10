// 解包 release 归档 (linux tar.gz, windows zip) 到暂存目录.

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { UPDATE_ERROR_KINDS, UpdateError } from "./errors.mjs";
import { powerShellSingleQuote } from "./escaping.mjs";

const run = promisify(execFile);
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export async function extractArchive({ archivePath, destination, platform = process.platform }) {
  await mkdir(destination, { recursive: true });
  const name = path.basename(archivePath);
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
    await extractTarGz({ archivePath, destination });
    return destination;
  }
  if (name.endsWith(".zip")) {
    await extractZip({ archivePath, destination, platform });
    return destination;
  }
  throw new UpdateError(`不支持的归档格式: ${name}`, { kind: UPDATE_ERROR_KINDS.unsupported });
}

export async function extractTarGz({ archivePath, destination }) {
  try {
    await run("tar", ["-xzf", archivePath, "-C", destination], {
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    throw new UpdateError(`解包归档失败: ${error instanceof Error ? error.message : "未知错误"}`, {
      kind: UPDATE_ERROR_KINDS.fileSystem,
      cause: error,
    });
  }
}

export async function extractZip({ archivePath, destination, platform = process.platform }) {
  const [command, args] = platform === "win32"
    ? ["powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command", `Expand-Archive -LiteralPath ${powerShellSingleQuote(archivePath)} -DestinationPath ${powerShellSingleQuote(destination)} -Force`,
    ]]
    : ["unzip", ["-o", archivePath, "-d", destination]];
  try {
    await run(command, args, { timeout: EXTRACT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
  } catch (error) {
    throw new UpdateError(`解包归档失败: ${error instanceof Error ? error.message : "未知错误"}`, {
      kind: UPDATE_ERROR_KINDS.fileSystem,
      cause: error,
    });
  }
}

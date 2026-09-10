// 更新流程的 HTTP 客户端.
//
// 代理策略: 所有对外请求都交给 Electron 的 net 模块发出, 它走 Chromium 网络栈, 默认遵循
// 系统代理设置 (macOS 读系统偏好, windows 读 Internet Settings, 其余平台读环境变量).
// 客户端不调用 session.setProxy, 避免覆盖用户设置; 每次请求前用 session.resolveProxy 重新
// 探测代理并写日志, 让运行期修改代理, 开关 VPN 的效果立刻可见.
// 调用方每次检查或下载都新建一个 client, 不要跨请求长期复用.

import { createWriteStream } from "node:fs";
import { net, session } from "electron";
import { UPDATE_ERROR_KINDS, UpdateError, httpStatusError } from "./errors.mjs";

export const UPDATE_USER_AGENT = "Pinote-Updater";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

export async function resolveProxyDescription(url, target = session.defaultSession) {
  try {
    const resolved = await target.resolveProxy(url);
    return resolved && resolved.length > 0 ? resolved : "DIRECT";
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : "探测失败"})`;
  }
}

export function firstHeader(headers, name) {
  const value = headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function performRequest(url, { headers = {}, method = "GET", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const timer = setTimeout(() => {
      settle(reject, new UpdateError("请求超时, 请检查网络或代理设置", { kind: UPDATE_ERROR_KINDS.timeout }));
      try {
        request?.abort();
      } catch {
        // 请求已经结束.
      }
    }, timeoutMs);

    function settle(handler, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    }

    try {
      request = net.request({ method, url, redirect: "follow" });
    } catch (error) {
      settle(reject, new UpdateError(`无法发起请求: ${error instanceof Error ? error.message : "未知错误"}`, {
        kind: UPDATE_ERROR_KINDS.network,
        cause: error,
      }));
      return;
    }
    request.on("response", (response) => settle(resolve, response));
    request.on("error", (error) => settle(reject, new UpdateError(`网络请求失败: ${error.message}`, {
      kind: UPDATE_ERROR_KINDS.network,
      cause: error,
    })));
    try {
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) request.setHeader(name, String(value));
      }
      request.end();
    } catch (error) {
      settle(reject, new UpdateError(`请求发送失败: ${error instanceof Error ? error.message : "未知错误"}`, {
        kind: UPDATE_ERROR_KINDS.network,
        cause: error,
      }));
    }
  });
}

function readText(response, { limitBytes = MAX_TEXT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    response.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        response.destroy?.(new Error("响应内容过大"));
        reject(new UpdateError("响应内容过大", { kind: UPDATE_ERROR_KINDS.network }));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", (error) => reject(new UpdateError(`读取响应失败: ${error.message}`, {
      kind: UPDATE_ERROR_KINDS.network,
      cause: error,
    })));
  });
}

function pipeToFile(response, { filePath, append, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let finished = false;
    const stream = createWriteStream(filePath, { flags: append ? "a" : "w" });
    const onAbort = () => {
      if (finished) return;
      finished = true;
      response.destroy?.(new Error("下载已取消"));
      stream.destroy();
      reject(new UpdateError("下载已取消", { kind: UPDATE_ERROR_KINDS.cancelled }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    response.on("data", (chunk) => {
      if (finished) return;
      received += chunk.length;
      stream.write(chunk);
      onProgress?.({ received, total: Number(firstHeader(response.headers, "content-length")) || null });
    });
    response.on("end", () => {
      if (finished) return;
      finished = true;
      stream.end(() => {
        cleanup();
        resolve(received);
      });
    });
    response.on("error", (error) => {
      if (finished) return;
      finished = true;
      stream.destroy();
      cleanup();
      reject(new UpdateError(`下载中断: ${error.message}`, { kind: UPDATE_ERROR_KINDS.network, cause: error }));
    });
    stream.on("error", (error) => {
      if (finished) return;
      finished = true;
      response.destroy?.(error);
      cleanup();
      reject(new UpdateError(`写入下载文件失败: ${error.message}`, { kind: UPDATE_ERROR_KINDS.fileSystem, cause: error }));
    });
  });
}

export function createHttpClient({ userAgent = UPDATE_USER_AGENT, timeoutMs = DEFAULT_TIMEOUT_MS, onProxy = () => {} } = {}) {
  async function traceProxy(url) {
    const proxy = await resolveProxyDescription(url);
    onProxy({ url, proxy });
    return proxy;
  }

  return {
    async getText(url, { headers = {}, accept } = {}) {
      await traceProxy(url);
      const response = await performRequest(url, {
        headers: { "User-Agent": userAgent, ...(accept ? { Accept: accept } : {}), ...headers },
        timeoutMs,
      });
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.destroy?.();
        throw httpStatusError(status, { url });
      }
      return { text: await readText(response), status, headers: response.headers };
    },

    async download(url, { filePath, append = false, onProgress, signal, headers = {}, expectedStatuses = [200, 206] } = {}) {
      await traceProxy(url);
      if (signal?.aborted) throw new UpdateError("下载已取消", { kind: UPDATE_ERROR_KINDS.cancelled });
      const response = await performRequest(url, {
        headers: { "User-Agent": userAgent, ...headers },
        timeoutMs,
      });
      const status = response.statusCode ?? 0;
      if (!expectedStatuses.includes(status)) {
        response.destroy?.();
        throw httpStatusError(status, { url });
      }
      const total = Number(firstHeader(response.headers, "content-length")) || null;
      const received = await pipeToFile(response, { filePath, append, onProgress, signal });
      return { status, received, total };
    },
  };
}

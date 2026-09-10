// 更新流程中统一使用的错误类型与用户可读文案.

export const UPDATE_ERROR_KINDS = Object.freeze({
  network: "network",
  timeout: "timeout",
  rateLimit: "rate-limit",
  notFound: "not-found",
  checksum: "checksum",
  unsupported: "unsupported",
  fileSystem: "file-system",
  cancelled: "cancelled",
  unknown: "unknown",
});

export class UpdateError extends Error {
  constructor(message, { kind = UPDATE_ERROR_KINDS.unknown, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "UpdateError";
    this.kind = kind;
  }
}

export function isUpdateError(error) {
  return error instanceof UpdateError;
}

export function describeError(error) {
  if (isUpdateError(error)) return error;
  return new UpdateError(error instanceof Error ? error.message : "未知错误", {
    kind: UPDATE_ERROR_KINDS.unknown,
    cause: error instanceof Error ? error : undefined,
  });
}

export function httpStatusError(status, { url, rateLimitHint = null }) {
  if (status === 403 || status === 429) {
    return new UpdateError(rateLimitHint ?? "GitHub API 访问频率受限, 请稍后再试", {
      kind: UPDATE_ERROR_KINDS.rateLimit,
    });
  }
  if (status === 404) {
    return new UpdateError("没有找到对应的发布产物", { kind: UPDATE_ERROR_KINDS.notFound });
  }
  return new UpdateError(`请求失败 (HTTP ${status})`, { kind: UPDATE_ERROR_KINDS.network });
}

import { randomUUID } from "node:crypto";

export class RendererFlushCoordinator {
  constructor(timeoutMs = 1_200, onTimeout = () => {}) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.requests = new Map();
  }

  request(targetIds, send) {
    const pending = new Set(targetIds);
    if (pending.size === 0) return Promise.resolve(true);

    const id = randomUUID();
    return new Promise((resolve) => {
      const request = { pending, resolve, timer: null, failed: false };
      request.timer = setTimeout(() => this.finish(id, true), this.timeoutMs);
      this.requests.set(id, request);
      for (const targetId of pending) send(targetId, id);
    });
  }

  complete(requestId, targetId, succeeded = true) {
    const request = this.requests.get(requestId);
    if (!request || !request.pending.delete(targetId)) return false;
    if (!succeeded) request.failed = true;
    if (request.pending.size === 0) this.finish(requestId, false);
    return true;
  }

  cancelAll() {
    for (const requestId of [...this.requests.keys()]) this.finish(requestId, false);
  }

  finish(requestId, timedOut) {
    const request = this.requests.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.requests.delete(requestId);
    if (timedOut) this.onTimeout(request.pending.size);
    request.resolve(!timedOut && !request.failed);
  }
}

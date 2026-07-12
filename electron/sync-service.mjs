import { safeStorage } from "electron";
import log from "electron-log/main.js";

const NORMAL_INTERVAL_MS = 15_000;
const CHANGE_DELAY_MS = 750;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

export class SyncService {
  constructor(store, windows) {
    this.store = store;
    this.windows = windows;
    this.token = "";
    this.timer = null;
    this.pendingTimer = null;
    this.running = null;
    this.controller = null;
    this.stopped = false;
    this.retryIndex = 0;
    this.status = { state: "idle", message: "同步未启用" };
  }

  initialize() {
    this.stopped = false;
    const encrypted = this.store.state.sync.encryptedToken;
    if (encrypted) {
      try {
        this.token = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch (error) {
        log.error("读取同步令牌失败", error);
      }
    }
    if (this.isConfigured()) void this.syncNow().catch(() => {});
    else this.scheduleNext(NORMAL_INTERVAL_MS);
  }

  async stop() {
    if (this.stopped) {
      await this.running?.catch(() => {});
      return;
    }
    this.stopped = true;
    this.clearScheduled();
    this.controller?.abort();
    await this.running?.catch((error) => {
      log.warn("等待同步停止时发生错误", { message: error instanceof Error ? error.message : "未知错误" });
    });
  }

  clearScheduled() {
    clearTimeout(this.timer);
    clearTimeout(this.pendingTimer);
    this.timer = null;
    this.pendingTimer = null;
  }

  getSettings() {
    return {
      url: this.store.state.sync.url,
      configured: this.isConfigured(),
      tokenPersistent: Boolean(this.store.state.sync.encryptedToken),
    };
  }

  getStatus() {
    return this.status;
  }

  async configure(settings) {
    if (this.stopped) throw new Error("同步服务正在停止");
    const url = normalizeUrl(settings?.url);
    const nextToken = typeof settings?.token === "string" ? settings.token.trim() : "";
    if (url && !nextToken && !this.token) throw new Error("首次连接需要填写令牌");
    if (nextToken) this.token = nextToken;
    if (!url) this.token = "";

    let encryptedToken = "";
    if (this.token && canPersistToken()) {
      encryptedToken = safeStorage.encryptString(this.token).toString("base64");
    } else if (this.token) {
      log.warn("系统安全存储不可用, 同步令牌仅保留到本次退出");
    }

    this.store.setSyncSettings(url, encryptedToken);
    this.retryIndex = 0;
    if (!url) {
      this.clearScheduled();
      this.controller?.abort();
      this.broadcast({ state: "idle", message: "同步未启用" });
      return this.getSettings();
    }
    await this.syncNow();
    return this.getSettings();
  }

  isConfigured() {
    return Boolean(this.store.state.sync.url && this.token);
  }

  schedule() {
    if (this.stopped || !this.isConfigured()) return;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => void this.syncNow().catch(() => {}), CHANGE_DELAY_MS);
  }

  syncNow() {
    if (this.stopped) return Promise.resolve(this.status);
    if (!this.isConfigured()) return Promise.resolve({ state: "idle", message: "同步未启用" });
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.running = this.performSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async performSync() {
    if (this.stopped) return this.status;
    this.broadcast({ state: "syncing", message: "正在同步" });
    const startedAt = Date.now();
    const request = this.store.buildSyncRequest();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);
    this.controller = controller;
    try {
      const response = await fetch(`${this.store.state.sync.url}/v1/sync`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      const snapshot = await response.json();
      clearTimeout(timeout);
      if (this.stopped) return this.status;
      const flushed = await this.windows.flushPendingNotes();
      if (!flushed) throw new Error("等待本地便签保存超时");
      if (this.stopped) return this.status;
      const result = this.store.applySyncResponse(snapshot, request);
      this.windows.reconcileRemoteState();
      this.retryIndex = 0;
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.scheduleNext(result.pending ? CHANGE_DELAY_MS : NORMAL_INTERVAL_MS);
      const status = {
        state: "synced",
        message: result.conflicts.length > 0 ? `同步完成, 已保留 ${result.conflicts.length} 个冲突副本` : "同步完成",
        syncedAt: Date.now(),
      };
      this.broadcast(status);
      log.info("同步完成", {
        durationMs: Date.now() - startedAt,
        changes: request.changes.length,
        deletions: request.deletions.length,
        conflicts: result.conflicts.length,
      });
      return status;
    } catch (error) {
      if (this.stopped || (!this.isConfigured() && isAbortError(error))) {
        log.info("同步请求已停止", { durationMs: Date.now() - startedAt });
        return this.status;
      }
      const message = timedOut ? "请求超时" : error instanceof Error ? error.message : "未知错误";
      const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
      this.retryIndex += 1;
      this.scheduleNext(delay);
      const status = { state: "error", message: `同步失败: ${message}` };
      this.broadcast(status);
      log.error("同步失败", { message, retryInMs: delay });
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
    }
  }

  scheduleNext(delay) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.isConfigured()) void this.syncNow().catch(() => {});
      else this.scheduleNext(NORMAL_INTERVAL_MS);
    }, delay);
  }

  broadcast(status) {
    this.status = status;
    this.windows.broadcast("sync:status", status);
  }
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("服务地址必须使用 HTTP 或 HTTPS");
  return url.toString().replace(/\/$/, "");
}

function canPersistToken() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== "linux") return true;
  return safeStorage.getSelectedStorageBackend() !== "basic_text";
}

function isAbortError(error) {
  return Boolean(error && typeof error === "object" && error.name === "AbortError");
}

import log from "electron-log/main.js";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

export class SseChangeStream {
  constructor(onChange, options = {}) {
    this.onChange = onChange;
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.logger = options.logger ?? log;
    this.generation = 0;
    this.controller = null;
    this.reconnectTimer = null;
    this.retryIndex = 0;
    this.tasks = new Set();
  }

  start(url, token) {
    this.generation += 1;
    const generation = this.generation;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.controller?.abort();
    this.retryIndex = 0;
    this.beginConnect(url, token, generation);
  }

  async stop() {
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.controller?.abort();
    await Promise.allSettled([...this.tasks]);
  }

  beginConnect(url, token, generation) {
    const task = this.connect(url, token, generation);
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }

  async connect(url, token, generation) {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await this.fetch(`${url}/v1/events`, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      if (!response.body) throw new Error("服务器未返回事件流");
      if (generation !== this.generation) return;

      this.retryIndex = 0;
      this.logger.info("同步事件流已连接");
      await readEvents(response.body, (event) => {
        if (generation !== this.generation || event.type !== "changed") return;
        this.onChange(event.data);
      });
      if (generation === this.generation) throw new Error("同步事件流已断开");
    } catch (error) {
      if (generation !== this.generation || isAbortError(error)) return;
      const message = error instanceof Error ? error.message : "未知错误";
      const delay = RECONNECT_DELAYS_MS[Math.min(this.retryIndex, RECONNECT_DELAYS_MS.length - 1)];
      this.retryIndex += 1;
      this.logger.warn("同步事件流连接失败", { message, retryInMs: delay });
      this.reconnectTimer = setTimeout(() => {
        if (generation === this.generation) this.beginConnect(url, token, generation);
      }, delay);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}

export class SseDecoder {
  constructor() {
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk;
    const events = [];
    while (true) {
      const boundary = this.buffer.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index === undefined) break;
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = parseEvent(block);
      if (event) events.push(event);
    }
    return events;
  }
}

async function readEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events = new SseDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of events.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of events.push(decoder.decode())) onEvent(event);
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(block) {
  let type = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") type = value;
    if (field === "data") data.push(value);
  }
  return data.length > 0 || type !== "message" ? { type, data: data.join("\n") } : null;
}

function isAbortError(error) {
  return Boolean(error && typeof error === "object" && error.name === "AbortError");
}

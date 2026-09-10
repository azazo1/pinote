// 更新窗口: 展示当前版本, 更新状态, release notes 与操作按钮.

import { BrowserWindow } from "electron";
import log from "electron-log/main.js";
import { loadRenderer, rendererPreferences } from "./renderer-host.mjs";

const UPDATE_WINDOW_WIDTH = 560;
const UPDATE_WINDOW_HEIGHT = 640;

export class UpdateWindow {
  #window = null;

  open({ focus = true } = {}) {
    if (this.#window && !this.#window.isDestroyed()) {
      if (this.#window.isMinimized()) this.#window.restore();
      if (focus) {
        this.#window.show();
        this.#window.focus();
      }
      return this.#window;
    }
    const window = new BrowserWindow({
      width: UPDATE_WINDOW_WIDTH,
      height: UPDATE_WINDOW_HEIGHT,
      minWidth: 460,
      minHeight: 420,
      show: false,
      title: "Pinote 更新",
      backgroundColor: "#f5f5f2",
      webPreferences: rendererPreferences(),
    });
    this.#window = window;
    loadRenderer(window, { view: "update" });
    window.once("ready-to-show", () => window.show());
    window.webContents.on("render-process-gone", (_event, details) => {
      log.error("更新窗口渲染进程退出", { reason: details.reason });
    });
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
    });
    log.info("已打开更新窗口");
    return window;
  }

  broadcast(channel, payload) {
    if (!this.#window || this.#window.isDestroyed()) return;
    this.#window.webContents.send(channel, payload);
  }

  close() {
    if (this.#window && !this.#window.isDestroyed()) this.#window.close();
    this.#window = null;
  }
}

// 渲染进程窗口的公共装载逻辑: 统一的 webPreferences 与页面入口.
//
// 主窗口, 便签窗口, 侧边架窗口与更新窗口都通过这里装载同一个前端入口, 用 query 区分视图.

import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function rendererPreferences() {
  return {
    preload: path.join(currentDir, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

export function loadRenderer(window, query) {
  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${new URLSearchParams(query)}`);
  } else {
    void window.loadFile(path.join(currentDir, "..", "dist", "index.html"), { query });
  }
}

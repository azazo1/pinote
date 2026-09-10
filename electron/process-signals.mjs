// 终端信号处理: 从终端启动的实例收到 Ctrl+C 走统一退出入口, 不被信号直接杀死.
//
// Windows 的 release 构建没有控制台 (GUI 子系统), 收不到 Ctrl+C, 因此只在
// macOS 与 linux 注册信号处理; windows 由托盘退出与系统关机事件负责收尾.

import log from "electron-log/main.js";

export const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM"];

export function installTerminationHandlers({ requestQuit, platform = process.platform, logger = log }) {
  if (platform === "win32") return [];
  const installed = [];
  for (const signal of TERMINATION_SIGNALS) {
    const handler = () => {
      logger.info(`收到 ${signal}, 开始优雅退出`);
      requestQuit(signal);
    };
    process.on(signal, handler);
    installed.push(signal);
  }
  return installed;
}

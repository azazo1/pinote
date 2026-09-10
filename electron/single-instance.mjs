// 单实例: 同一数据目录下只允许一个实例运行.
//
// Electron 的单实例锁绑定在 userData 目录上, 所以必须在 app.setPath("userData", ...) 之后
// 申请锁, 这样 just debug 的隔离实例与 fake 构建都能和正式实例并行运行.

import log from "electron-log/main.js";

export function acquireSingleInstanceLock({ app, onSecondInstance }) {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    log.info("已存在同一数据目录的实例, 当前进程退出");
    return false;
  }
  app.on("second-instance", (event, argv, workingDirectory) => {
    log.info("收到二次启动请求", { argv, workingDirectory });
    onSecondInstance?.(argv);
  });
  return true;
}

export function releaseSingleInstanceLock({ app, log: logger = log } = {}) {
  if (typeof app.releaseSingleInstanceLock !== "function") return false;
  try {
    app.releaseSingleInstanceLock();
    logger.info("已释放单实例锁");
    return true;
  } catch (error) {
    logger.warn("释放单实例锁失败", { message: error instanceof Error ? error.message : "未知错误" });
    return false;
  }
}

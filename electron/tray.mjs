// 系统托盘: 左键显示主窗口, 右键弹出菜单, 菜单首部显示应用名与版本号.

import { Menu, Tray } from "electron";
import log from "electron-log/main.js";
import { createTrayIcon } from "./tray-icon.mjs";

export function createAppTray({
  appName,
  version,
  iconPath,
  templatePath,
  retinaTemplatePath,
  isAutoCheckEnabled,
  onOpenMainWindow,
  onCreateNote,
  onCheckUpdates,
  onToggleAutoCheck,
  onQuit,
}) {
  const source = createTrayIcon({ templatePath, retinaTemplatePath, appIconPath: iconPath });
  if (source.isEmpty()) {
    log.warn("系统托盘图标不可用", { iconPath });
    return null;
  }

  const tray = new Tray(source);
  tray.setToolTip(`${appName}\n${version}`);

  const buildMenu = () => Menu.buildFromTemplate([
    { label: `${appName} ${version}`, enabled: false },
    { type: "separator" },
    { label: "打开主窗口", click: onOpenMainWindow },
    { label: "新建便签", click: onCreateNote },
    { type: "separator" },
    { label: "检查更新", click: onCheckUpdates },
    {
      label: "启动时自动检查更新",
      type: "checkbox",
      checked: Boolean(isAutoCheckEnabled()),
      click: (menuItem) => onToggleAutoCheck(menuItem.checked),
    },
    { type: "separator" },
    { label: `退出 ${appName}`, click: onQuit },
  ]);

  const refresh = () => {
    if (process.platform === "darwin") return;
    tray.setContextMenu(buildMenu());
  };

  tray.on("click", onOpenMainWindow);
  if (process.platform === "darwin") {
    tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
  } else {
    tray.setContextMenu(buildMenu());
  }
  log.info("系统托盘已就绪", { platform: process.platform, version });
  return { tray, refresh };
}

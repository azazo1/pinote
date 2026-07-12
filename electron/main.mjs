import { app, BrowserWindow, dialog, ipcMain, Menu, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { NoteStore } from "./note-store.mjs";
import { createTrayIcon } from "./tray-icon.mjs";
import { WindowManager } from "./window-manager.mjs";
import { SyncService } from "./sync-service.mjs";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.VITE_DEV_SERVER_URL ? "debug" : "info";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const RESIZE_EDGES = new Set(["n", "s", "e", "w", "nw", "sw", "se"]);

let store;
let windows;
let sync;
let tray = null;
let quitStarted = false;
let quitReady = false;
let quitConfirmationOpen = false;

if (process.env.PINOTE_USER_DATA) app.setPath("userData", process.env.PINOTE_USER_DATA);

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    log.info("macOS 应用窗口策略已设置", { activationPolicy: "regular" });
  }
  log.info("Pinote 正在启动", { platform: process.platform, electron: process.versions.electron });
  store = new NoteStore(app.getPath("userData"));
  await store.load();
  windows = new WindowManager(store);
  sync = new SyncService(store, windows);
  registerIpc();
  installMenu();
  installTray();
  windows.openMainWindow();
  for (const note of store.state.notes) {
    if (store.getWindowState(note.id).open) windows.open(note);
  }
  windows.restoreDockedMode();
  sync.initialize();

  app.on("activate", () => {
    if (quitStarted || !windows.shouldOpenMainWindowOnActivate()) return;
    windows.openMainWindow();
  });
}).catch((error) => {
  log.error("Pinote 启动失败", error);
  app.quit();
});

app.on("window-all-closed", () => {
  const trayAvailable = tray && !tray.isDestroyed();
  if (process.platform !== "darwin" && !trayAvailable) app.quit();
});

app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitStarted) return;
  quitStarted = true;
  windows?.prepareToQuit();
  void (async () => {
    let completed = false;
    try {
      let flushed = windows ? await windows.flushPendingNotes() : true;
      if (!flushed && windows) flushed = await windows.flushPendingNotes();
      if (!flushed) throw new Error("仍有便签内容未保存");
      await sync?.stop();
      await store?.save();
      completed = true;
    } catch (error) {
      log.error("退出前保存失败", error);
      dialog.showErrorBox("Pinote 无法退出", "仍有便签内容未保存, 请稍后重试.");
    } finally {
      if (completed) {
        quitReady = true;
        app.quit();
      } else {
        quitStarted = false;
        windows?.cancelQuit();
        if (sync?.stopped) sync.initialize();
        windows?.openMainWindow();
      }
    }
  })();
});

app.on("will-quit", () => {
  tray?.destroy();
  tray = null;
});

function registerIpc() {
  ipcMain.handle("note:get", (_event, id) => ({
    note: store.getRenderableNote(validId(id)),
    group: windows.getGroupState(),
    capabilities: windows.getCapabilities(),
  }));
  ipcMain.handle("note:update", (_event, id, patch, baseRevision) => {
    const note = store.updateContent(validId(id), sanitizePatch(patch), validBaseRevision(baseRevision));
    windows.broadcastNoteList();
    sync.schedule();
    return note;
  });
  ipcMain.handle("note:create", () => {
    const note = windows.createNearFocused();
    sync.schedule();
    return note;
  });
  ipcMain.handle("note:open", (_event, id) => windows.openNote(validId(id)));
  ipcMain.on("note:flush-complete", (event, requestId, succeeded) => {
    windows.completePendingNoteFlush(event.sender.id, requestId, succeeded);
  });
  ipcMain.handle("note:close", (_event, id) => windows.closeNote(validId(id)));
  ipcMain.handle("note:delete", async (event, id) => {
    id = validId(id);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: "warning",
      buttons: ["取消", "删除"],
      defaultId: 0,
      cancelId: 0,
      message: "删除这张便签?",
      detail: "删除操作会同步到其他设备.",
    };
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (result.response !== 1) return;
    windows.remove(id);
    sync.schedule();
  });
  ipcMain.handle("window:open-main", () => windows.openMainWindow() !== null);
  ipcMain.handle("app:request-quit", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (
      quitStarted ||
      quitConfirmationOpen ||
      !owner ||
      owner.isDestroyed() ||
      owner !== windows.mainWindow
    ) return false;

    quitConfirmationOpen = true;
    try {
      const result = await dialog.showMessageBox(owner, {
        type: "warning",
        buttons: ["取消", "退出 Pinote"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: "退出 Pinote?",
        detail: "所有便签窗口将关闭, 后台同步也会停止.",
      });
      if (result.response !== 1) return false;
      log.info("用户从主窗口确认退出应用");
      app.quit();
      return true;
    } finally {
      quitConfirmationOpen = false;
    }
  });
  ipcMain.handle("window:toggle-collapse", (_event, id) => windows.toggleCollapse(validId(id)));
  ipcMain.on("window:move-start", (event, id) => windows.beginMove(validId(id), event.sender));
  ipcMain.on("window:move", (event, id, x, y, pointerX, pointerY) => {
    if ([x, y, pointerX, pointerY].every(Number.isFinite)) {
      windows.move(validId(id), x, y, pointerX, pointerY, event.sender);
    }
  });
  ipcMain.on("window:move-end", (event, id) => windows.endMove(validId(id), event.sender));
  ipcMain.on("window:enable-focus", (event, id) => windows.enableWindowFocus(validId(id), event.sender));
  ipcMain.on("window:resize-start", (event, id) => windows.beginResize(validId(id), event.sender));
  ipcMain.on("window:resize", (event, id, edge, size) => {
    const safeSize = validWindowSize(size);
    if (validResizeEdge(edge) && safeSize) windows.resize(validId(id), edge, safeSize, event.sender);
  });
  ipcMain.on("window:resize-end", (event, id) => windows.endResize(validId(id), event.sender));
  ipcMain.handle("window:set-pinned", (_event, id, pinned) => windows.setPinned(validId(id), Boolean(pinned)));
  ipcMain.handle("group:toggle-note-dock", (_event, id) => windows.toggleNoteDock(validId(id)));
  ipcMain.on("group:reveal", () => windows.revealGroup());
  ipcMain.on("group:hide", () => windows.scheduleHideGroup());
  ipcMain.on("group:cancel-hide", () => windows.cancelHideGroup());
  ipcMain.handle("notes:list", () => store.listSummaries());
  ipcMain.handle("group:activate-note", (_event, id) => windows.activateDockedNote(validId(id)));
  ipcMain.handle("group:close-docked-note", (_event, id) => windows.closeDockedNote(validId(id)));
  ipcMain.on("shelf:set-expanded", (_event, expanded) => windows.setShelfExpanded(Boolean(expanded)));
  ipcMain.on("shelf:move-start", (event) => windows.beginShelfMove(event.sender));
  ipcMain.on("shelf:move", (event, deltaX, deltaY) => {
    if (validWindowDelta(deltaX) && validWindowDelta(deltaY)) windows.moveShelf(deltaX, deltaY, event.sender);
  });
  ipcMain.on("shelf:move-end", (event) => windows.endShelfMove(event.sender));
  ipcMain.on("shelf:note-drag-start", (event, id, pointerX, pointerY, sourceBounds) => {
    if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
      windows.beginShelfNoteDrag(validId(id), pointerX, pointerY, validWindowBounds(sourceBounds), event.sender);
    }
  });
  ipcMain.on("shelf:note-drag", (event, id, pointerX, pointerY, dropBounds) => {
    if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
      windows.moveShelfNoteDrag(validId(id), pointerX, pointerY, validWindowBounds(dropBounds), event.sender);
    }
  });
  ipcMain.on("shelf:note-drag-end", (event, id) => windows.endShelfNoteDrag(validId(id), event.sender));
  ipcMain.handle("sync:get-settings", () => sync.getSettings());
  ipcMain.handle("sync:get-status", () => sync.getStatus());
  ipcMain.handle("sync:configure", (_event, settings) => sync.configure(settings));
  ipcMain.handle("sync:now", () => sync.syncNow());
}

function installMenu() {
  const newNoteAccelerator = process.platform === "darwin" ? "Command+N" : "Control+Shift+N";
  const focusSearchAccelerator = process.platform === "darwin" ? "Command+F" : "Control+Shift+F";
  const sendCommand = (command) => (_menuItem, focusedWindow) => {
    focusedWindow?.webContents.send("app:command", command);
  };
  const closeFocusedWindow = (_menuItem, focusedWindow) => {
    if (!focusedWindow || focusedWindow === windows.shelfWindow) return;
    if (focusedWindow === windows.mainWindow) {
      focusedWindow.close();
      return;
    }
    focusedWindow.webContents.send("app:command", "close-window");
  };
  const template = [
    {
      label: "Pinote",
      submenu: [
        { label: "关于 Pinote", role: "about" },
        { type: "separator" },
        { id: "open-main-window", label: "打开主窗口", accelerator: "CommandOrControl+0", click: () => windows.openMainWindow() },
        { type: "separator" },
        { label: "隐藏 Pinote", role: "hide" },
        { label: "退出 Pinote", role: "quit" },
      ],
    },
    {
      label: "便签",
      submenu: [
        { id: "new-note", label: "新建便签", accelerator: newNoteAccelerator, click: () => windows.createNearFocused() },
        { id: "close-window", label: "关闭当前窗口", accelerator: "CommandOrControl+W", click: closeFocusedWindow },
        { type: "separator" },
        { id: "focus-title", label: "聚焦标题", accelerator: "CommandOrControl+1", click: sendCommand("focus-title") },
        { id: "focus-editor", label: "聚焦正文", accelerator: "CommandOrControl+2", click: sendCommand("focus-editor") },
        { id: "toggle-collapse", label: "收起或展开", accelerator: "CommandOrControl+M", click: sendCommand("toggle-collapse") },
        { type: "separator" },
        { id: "toggle-pin", label: "置顶或取消置顶", accelerator: "CommandOrControl+Shift+P", click: sendCommand("toggle-pin") },
        { id: "toggle-dock", label: "切换当前便签的侧边收纳", accelerator: "CommandOrControl+Shift+D", click: sendCommand("toggle-dock") },
        { id: "toggle-color-picker", label: "便签颜色", accelerator: "CommandOrControl+Shift+C", click: sendCommand("toggle-color-picker") },
        { id: "toggle-metadata", label: "分组与标签", accelerator: "CommandOrControl+Shift+T", click: sendCommand("toggle-metadata") },
      ],
    },
    {
      label: "视图",
      submenu: [
        { id: "focus-search", label: "搜索便签", accelerator: focusSearchAccelerator, click: sendCommand("focus-search") },
        { id: "toggle-sync", label: "同步设置", accelerator: "CommandOrControl+,", click: sendCommand("toggle-sync") },
      ],
    },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installTray() {
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(currentDir, "..", "build", "generated", "icon.png");
    const source = createTrayIcon({
      templatePath: path.join(currentDir, "assets", "trayTemplate.png"),
      retinaTemplatePath: path.join(currentDir, "assets", "trayTemplate@2x.png"),
      appIconPath: iconPath,
    });
    if (source.isEmpty()) {
      log.warn("系统托盘图标不可用", { iconPath });
      return;
    }
    tray = new Tray(source);
    tray.setToolTip("Pinote");

    const openMainWindow = () => {
      if (quitStarted) return;
      log.info("从系统托盘打开主窗口");
      windows.openMainWindow();
    };
    const createNote = () => {
      if (quitStarted) return;
      const note = windows.createNearFocused();
      sync.schedule();
      log.info("从系统托盘新建便签", { id: note.id });
    };
    const quit = () => {
      if (quitStarted) return;
      log.info("从系统托盘退出 Pinote");
      app.quit();
    };
    const menu = Menu.buildFromTemplate([
      { label: "打开主窗口", click: openMainWindow },
      { label: "新建便签", click: createNote },
      { type: "separator" },
      { label: "退出 Pinote", click: quit },
    ]);

    tray.on("click", openMainWindow);
    if (process.platform === "darwin") tray.on("right-click", () => tray?.popUpContextMenu(menu));
    else tray.setContextMenu(menu);
    windows.setTrayAvailable(true);
    log.info("系统托盘已就绪", { platform: process.platform });
  } catch (error) {
    tray = null;
    windows.setTrayAvailable(false);
    log.error("创建系统托盘失败", error);
  }
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== "object") return {};
  const safe = {};
  if (typeof patch.title === "string") safe.title = truncateCodePoints(patch.title, 200);
  if (typeof patch.markdown === "string") safe.markdown = patch.markdown.slice(0, 2_000_000);
  if (typeof patch.color === "string") safe.color = patch.color.slice(0, 32);
  if (typeof patch.groupName === "string") safe.groupName = truncateCodePoints(patch.groupName.trim(), 80).trim();
  if (Array.isArray(patch.tags)) safe.tags = sanitizeTags(patch.tags);
  return safe;
}

function sanitizeTags(values) {
  const tags = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = truncateCodePoints(value.trim().replace(/^#+/, "").trim(), 40).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === 16) break;
  }
  return tags;
}

function truncateCodePoints(value, length) {
  return Array.from(value).slice(0, length).join("");
}

function validId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("便签 id 无效");
  return value;
}

function validBaseRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function validResizeEdge(value) {
  return RESIZE_EDGES.has(value);
}

function validWindowSize(value) {
  if (!value || typeof value !== "object") return null;
  const entries = [value.width, value.height];
  if (!entries.every((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1_000_000)) return null;
  return {
    width: Math.round(value.width),
    height: Math.round(value.height),
  };
}

function validWindowBounds(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") return null;
  const entries = [value.x, value.y, value.width, value.height];
  if (!entries.every((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1_000_000)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
  };
}

function validWindowDelta(value) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

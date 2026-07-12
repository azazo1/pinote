import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { NoteStore } from "./note-store.mjs";
import { WindowManager } from "./window-manager.mjs";
import { SyncService } from "./sync-service.mjs";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.VITE_DEV_SERVER_URL ? "debug" : "info";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

let store;
let windows;
let sync;
let tray = null;
let quitStarted = false;
let quitReady = false;

if (process.env.PINOTE_USER_DATA) app.setPath("userData", process.env.PINOTE_USER_DATA);

app.whenReady().then(async () => {
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
  ipcMain.handle("window:toggle-collapse", (_event, id) => windows.toggleCollapse(validId(id)));
  ipcMain.on("window:move", (_event, id, x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) windows.move(validId(id), x, y);
  });
  ipcMain.handle("window:set-pinned", (_event, id, pinned) => windows.setPinned(validId(id), Boolean(pinned)));
  ipcMain.handle("group:toggle-note-dock", (_event, id) => windows.toggleNoteDock(validId(id)));
  ipcMain.on("group:reveal", () => windows.revealGroup());
  ipcMain.on("group:hide", () => windows.scheduleHideGroup());
  ipcMain.on("group:cancel-hide", () => windows.cancelHideGroup());
  ipcMain.handle("notes:list", () => store.listSummaries());
  ipcMain.handle("group:activate-note", (_event, id) => windows.activateDockedNote(validId(id)));
  ipcMain.on("shelf:set-expanded", (_event, expanded) => windows.setShelfExpanded(Boolean(expanded)));
  ipcMain.on("shelf:move", (_event, screenY) => {
    if (Number.isFinite(screenY)) windows.moveShelf(screenY);
  });
  ipcMain.handle("sync:get-settings", () => sync.getSettings());
  ipcMain.handle("sync:get-status", () => sync.getStatus());
  ipcMain.handle("sync:configure", (_event, settings) => sync.configure(settings));
  ipcMain.handle("sync:now", () => sync.syncNow());
}

function installMenu() {
  const sendCommand = (command) => BrowserWindow.getFocusedWindow()?.webContents.send("app:command", command);
  const template = [
    {
      label: "Pinote",
      submenu: [
        { label: "关于 Pinote", role: "about" },
        { type: "separator" },
        { label: "打开主窗口", click: () => windows.openMainWindow() },
        { type: "separator" },
        { label: "隐藏 Pinote", role: "hide" },
        { label: "退出 Pinote", role: "quit" },
      ],
    },
    {
      label: "便签",
      submenu: [
        { label: "新建便签", accelerator: "CommandOrControl+N", click: () => windows.createNearFocused() },
        { label: "收起或展开", accelerator: "CommandOrControl+M", click: () => sendCommand("toggle-collapse") },
        { type: "separator" },
        { label: "切换当前便签的侧边收纳", accelerator: "CommandOrControl+Shift+D", click: () => sendCommand("toggle-dock") },
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
    const source = trayIcon(iconPath);
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

function trayIcon(iconPath) {
  if (process.platform === "darwin") {
    const template = nativeImage.createFromNamedImage("NSImageNameBookmarksTemplate");
    if (!template.isEmpty()) {
      template.setTemplateImage(true);
      return template;
    }
  }
  const source = nativeImage.createFromPath(iconPath);
  if (source.isEmpty()) return source;
  const size = process.platform === "darwin" ? 18 : 20;
  return source.resize({ width: size, height: size, quality: "best" });
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

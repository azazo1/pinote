import { app, BrowserWindow, dialog, ipcMain, Menu, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { NoteStore } from "./note-store.mjs";
import { ShortcutManager } from "./shortcut-manager.mjs";
import { SHORTCUT_COMMANDS } from "./shortcut-settings.mjs";
import { createTrayIcon } from "./tray-icon.mjs";
import { WindowManager } from "./window-manager.mjs";
import { SyncService } from "./sync-service.mjs";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.VITE_DEV_SERVER_URL ? "debug" : "info";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const RESIZE_EDGES = new Set(["n", "s", "e", "w", "nw", "sw", "se"]);
const LOGIN_HIDDEN_ARGUMENT = "--pinote-login-hidden";
const NOTE_COMMANDS = new Set([
  "focus-title",
  "focus-editor",
  "toggle-collapse",
  "toggle-pin",
  "toggle-dock",
  "toggle-color-picker",
  "toggle-metadata",
  "toggle-archive",
]);

if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

let store;
let windows;
let sync;
let shortcutManager;
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
  windows = new WindowManager(store, {
    requestQuit: (owner) => void confirmAndQuit(owner),
    showDock: showDockIcon,
    hideDock: hideDockIcon,
  });
  sync = new SyncService(store, windows);
  registerIpc();
  installTray();
  sync.initialize();
  shortcutManager = new ShortcutManager({
    platform: process.platform,
    getBindings: () => store.getPreferences().shortcuts,
    saveBindings: (shortcuts) => store.updatePreferences({ shortcuts }),
    execute: (id) => executeShortcut(id, BrowserWindow.getFocusedWindow()),
    installMenu,
    broadcast: broadcastSettings,
  });
  shortcutManager.initialize();
  if (!process.argv.includes(LOGIN_HIDDEN_ARGUMENT)) windows.openMainWindow();
  for (const note of store.state.notes) {
    if (store.getWindowState(note.id).open) windows.open(note);
  }
  windows.restoreDockedMode();

  app.on("activate", () => {
    if (quitStarted || !windows.shouldOpenMainWindowOnActivate()) return;
    windows.openMainWindow();
  });
  app.on("browser-window-blur", (_event, window) => {
    if (quitStarted) return;
    windows.handleBrowserWindowBlur(window);
  });
  app.on("browser-window-focus", () => windows.cancelAppBlurHide());
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
  shortcutManager?.dispose();
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
  ipcMain.handle("note:create-docked", () => {
    const note = windows.createDockedNote();
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
  ipcMain.handle("note:set-archived", (_event, id, archived) => {
    const note = windows.setNoteArchived(validId(id), Boolean(archived));
    if (note) sync.schedule();
    return note;
  });
  ipcMain.handle("window:open-main", () => windows.openMainWindow() !== null);
  ipcMain.handle("app:request-quit", (event) => confirmAndQuit(BrowserWindow.fromWebContents(event.sender)));
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
  ipcMain.handle("settings:get", () => getAppSettings());
  ipcMain.handle("settings:update-general", (_event, patch) => updateGeneralSettings(patch));
  ipcMain.handle("settings:update-shortcut", (_event, id, patch) => {
    shortcutManager.update(id, patch);
    return getAppSettings();
  });
  ipcMain.handle("settings:reset-shortcut", (_event, id) => {
    shortcutManager.reset(id);
    return getAppSettings();
  });
  ipcMain.handle("settings:reset-shortcuts", () => {
    shortcutManager.resetAll();
    return getAppSettings();
  });
  ipcMain.handle("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  }));
}

function installMenu(bindings) {
  const item = (id, label = SHORTCUT_COMMANDS.find((command) => command.id === id)?.label) => {
    const binding = bindings[id];
    return {
      id,
      label,
      ...(binding?.accelerator && !binding.global ? { accelerator: binding.accelerator } : {}),
      click: (_menuItem, focusedWindow) => executeShortcut(id, focusedWindow),
    };
  };
  const template = [
    {
      label: "Pinote",
      submenu: [
        { label: "关于 Pinote", role: "about" },
        { type: "separator" },
        item("open-main-window"),
        { type: "separator" },
        { label: "隐藏 Pinote", role: "hide" },
        { label: "退出 Pinote", role: "quit" },
      ],
    },
    {
      label: "便签",
      submenu: [
        item("new-note"),
        item("close-window"),
        { type: "separator" },
        item("focus-title"),
        item("focus-editor"),
        item("toggle-collapse"),
        { type: "separator" },
        item("toggle-pin"),
        item("toggle-dock", "切换当前便签的侧边收纳"),
        item("toggle-color-picker"),
        item("toggle-metadata"),
        item("toggle-archive"),
      ],
    },
    {
      label: "视图",
      submenu: [
        item("focus-search"),
        item("open-settings"),
        item("sync-now"),
      ],
    },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function executeShortcut(id, focusedWindow) {
  if (quitStarted) return;
  if (id === "open-main-window") {
    windows.openMainWindow();
    return;
  }
  if (id === "new-note") {
    windows.createNearFocused();
    sync.schedule();
    return;
  }
  if (id === "focus-search") {
    sendMainCommand("focus-search");
    return;
  }
  if (id === "open-settings") {
    sendMainCommand("open-settings");
    return;
  }
  if (id === "sync-now") {
    void sync.syncNow().catch(() => {});
    return;
  }
  if (id === "close-window") {
    if (!focusedWindow || focusedWindow === windows.shelfWindow) return;
    if (focusedWindow === windows.mainWindow) focusedWindow.close();
    else focusedWindow.webContents.send("app:command", "close-window");
    return;
  }
  if (!NOTE_COMMANDS.has(id) || !focusedWindow || focusedWindow === windows.mainWindow || focusedWindow === windows.shelfWindow) return;
  focusedWindow.webContents.send("app:command", id);
}

function sendMainCommand(command) {
  const window = windows.openMainWindow();
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send("app:command", command);
  };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once("did-finish-load", send);
  else send();
}

async function confirmAndQuit(owner) {
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
}

function getAppSettings() {
  const preferences = store.getPreferences();
  const loginSupported = process.platform === "darwin" || process.platform === "win32";
  let launchAtLogin = false;
  if (loginSupported) {
    try {
      launchAtLogin = app.getLoginItemSettings().openAtLogin;
    } catch (error) {
      log.warn("读取登录启动状态失败", { message: error instanceof Error ? error.message : "未知错误" });
    }
  }
  return {
    general: {
      launchAtLogin,
      launchAtLoginSupported: loginSupported,
      showMainOnLogin: preferences.showMainOnLogin,
      closeMainToTray: preferences.closeMainToTray,
      hideDockOnMainClose: preferences.hideDockOnMainClose,
      hideDockOnMainCloseSupported: process.platform === "darwin",
      defaultNoteColor: preferences.defaultNoteColor,
      defaultNotePinned: preferences.defaultNotePinned,
    },
    shortcuts: SHORTCUT_COMMANDS.map((command) => ({
      ...command,
      ...preferences.shortcuts[command.id],
    })),
  };
}

function updateGeneralSettings(patch) {
  if (!patch || typeof patch !== "object") throw new Error("设置内容无效");
  const current = store.getPreferences();
  const preferencesPatch = {};
  for (const key of ["showMainOnLogin", "closeMainToTray", "hideDockOnMainClose", "defaultNotePinned"]) {
    if (typeof patch[key] === "boolean") preferencesPatch[key] = patch[key];
  }
  if (typeof patch.defaultNoteColor === "string") preferencesPatch.defaultNoteColor = patch.defaultNoteColor;
  const nextShowMainOnLogin = preferencesPatch.showMainOnLogin ?? current.showMainOnLogin;
  const loginSupported = process.platform === "darwin" || process.platform === "win32";
  if (Object.hasOwn(patch, "launchAtLogin")) {
    if (!loginSupported) throw new Error("当前系统不支持登录时启动");
    setLoginItem(Boolean(patch.launchAtLogin), nextShowMainOnLogin);
  } else if (preferencesPatch.showMainOnLogin !== undefined && loginSupported) {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;
    if (openAtLogin) setLoginItem(true, nextShowMainOnLogin);
  }
  if (Object.keys(preferencesPatch).length > 0) store.updatePreferences(preferencesPatch);
  log.info("通用设置已更新", { keys: Object.keys(patch) });
  broadcastSettings();
  return getAppSettings();
}

function setLoginItem(openAtLogin, showMainOnLogin) {
  app.setLoginItemSettings({
    openAtLogin,
    args: openAtLogin && !showMainOnLogin ? [LOGIN_HIDDEN_ARGUMENT] : [],
  });
}

function broadcastSettings() {
  windows.broadcast("settings:changed", getAppSettings());
}

function showDockIcon() {
  if (process.platform !== "darwin") return;
  void app.dock.show().catch((error) => {
    log.warn("显示 Dock 图标失败", { message: error instanceof Error ? error.message : "未知错误" });
  });
}

function hideDockIcon() {
  if (process.platform !== "darwin") return;
  app.dock.hide();
  log.info("主窗口关闭后已隐藏 Dock 图标");
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

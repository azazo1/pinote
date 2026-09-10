import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { configureAppLogging, installProcessErrorHandlers, logRuntimeInfo, setLogLevel } from "./app-logging.mjs";
import { NoteStore } from "./note-store.mjs";
import { ShortcutManager } from "./shortcut-manager.mjs";
import { SHORTCUT_COMMANDS } from "./shortcut-settings.mjs";
import { WindowManager } from "./window-manager.mjs";
import { SyncService } from "./sync-service.mjs";
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from "./single-instance.mjs";
import { installTerminationHandlers } from "./process-signals.mjs";
import { createAppTray } from "./tray.mjs";
import { UpdateService } from "./update-service.mjs";
import { UpdateWindow } from "./update-window.mjs";
import { resolveUpdateConfig } from "./update/release-query.mjs";
import { isDevBuildVersion, isFakeBuildVersion, resolveRuntimeVersion } from "./version.mjs";

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

// 版本号在窗口与托盘都出现, 启动时解析一次即可.
const runtimeVersion = resolveRuntimeVersion({
  env: process.env,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appVersion: app.getVersion(),
});

// 数据目录: 显式覆盖优先, 其次是 fake 构建的隔离目录, 保证 fake 实例与正式实例互不干扰.
if (process.env.PINOTE_USER_DATA) app.setPath("userData", process.env.PINOTE_USER_DATA);
else if (isFakeBuildVersion(runtimeVersion)) app.setPath("userData", `${app.getPath("userData")}-fake`);

const { filePath: logFile, level: initialLogLevel } = configureAppLogging({
  userDataPath: app.getPath("userData"),
});
installProcessErrorHandlers();

let store;
let windows;
let sync;
let shortcutManager;
let tray = null;
let trayController = null;
let updateService = null;
let updateWindow = null;
let quitStarted = false;
let quitReady = false;
let quitConfirmationOpen = false;
let quitForUpdate = false;

if (!acquireSingleInstanceLock({
  app,
  onSecondInstance: () => {
    if (quitStarted) return;
    windows?.openMainWindow();
  },
})) {
  app.quit();
} else {
  startApplication();
}

function startApplication() {
  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.setActivationPolicy("regular");
      log.info("macOS 应用窗口策略已设置", { activationPolicy: "regular" });
    }
    logRuntimeInfo({ app, version: runtimeVersion, logFile, level: initialLogLevel });
    store = new NoteStore(app.getPath("userData"));
    await store.load();
    if (store.getPreferences().verboseLogging) setLogLevel("debug");
    windows = new WindowManager(store, {
      requestQuit: (owner) => void confirmAndQuit(owner),
      showDock: showDockIcon,
      hideDock: hideDockIcon,
      isAppActive: () => process.platform === "darwin" ? app.isActive() : Boolean(BrowserWindow.getFocusedWindow()),
    });
    sync = new SyncService(store, windows);
    updateWindow = new UpdateWindow();
    updateService = new UpdateService({
      store,
      userDataPath: app.getPath("userData"),
      currentVersion: runtimeVersion,
      ...resolveUpdateConfig(process.env),
      execPath: process.execPath,
      packaged: app.isPackaged,
      logger: log,
      notify: notifyUpdate,
      broadcast: broadcastUpdateState,
      requestQuit: (reason) => {
        if (reason === "update") quitForUpdate = true;
        app.quit();
      },
      restartApp: restartApplication,
      openArtifact: openUpdateArtifact,
      openReleasePage,
    });
    registerIpc();
    installTray();
    installTerminationHandlers({
      requestQuit: (signal) => {
        if (quitStarted) return;
        log.info("终端信号触发退出", { signal });
        app.quit();
      },
    });
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
    updateService.initialize();
    const startHidden = store.getPreferences().startHidden || process.argv.includes(LOGIN_HIDDEN_ARGUMENT);
    if (!startHidden) windows.openMainWindow();
    else log.info("按设置保持主窗口隐藏");
    for (const note of store.state.notes) {
      if (store.getWindowState(note.id).open && store.getDockState(note.id) !== "shelf") windows.open(note);
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
    if (process.platform === "darwin") {
      app.on("did-resign-active", () => windows.handleApplicationBlur());
      app.on("did-become-active", () => windows.cancelAppBlurHide());
    }
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
        if (!flushed && !quitForUpdate) throw new Error("仍有便签内容未保存");
        await sync?.stop();
        await store?.save();
        completed = true;
      } catch (error) {
        log.error("退出前保存失败", error);
        if (!quitForUpdate) dialog.showErrorBox("Pinote 无法退出", "仍有便签内容未保存, 请稍后重试.");
      } finally {
        if (completed || quitForUpdate) {
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
    log.info("Pinote 正在退出", { version: runtimeVersion });
    releaseSingleInstanceLock({ app });
    updateService?.dispose();
    shortcutManager?.dispose();
    tray?.destroy();
    tray = null;
    trayController = null;
  });
}

function registerIpc() {
  ipcMain.handle("note:get", (_event, id) => ({
    note: store.getRenderableNote(validId(id)),
    group: windows.getGroupState(),
    capabilities: windows.getCapabilities(),
  }));
  ipcMain.handle("note:update", (_event, id, patch, baseRevision) => {
    id = validId(id);
    const note = store.updateContent(id, sanitizePatch(patch), validBaseRevision(baseRevision));
    windows.broadcastNoteList();
    if (note && !store.isDraft(id)) sync.schedule();
    return note;
  });
  ipcMain.handle("note:create", () => {
    return windows.createNearFocused();
  });
  ipcMain.handle("note:create-docked", () => {
    return windows.createDockedNote();
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
  ipcMain.handle("group:dock-note", (_event, id) => windows.dockNoteResult(validId(id)));
  ipcMain.handle("group:undock-note", (_event, id) => windows.undockNoteResult(validId(id)));
  ipcMain.on("group:reveal", () => windows.revealGroup());
  ipcMain.on("group:hide", () => windows.scheduleHideGroup());
  ipcMain.on("group:cancel-hide", () => windows.cancelHideGroup());
  ipcMain.handle("notes:list", (_event, includeDrafts) => store.listSummaries(includeDrafts === true));
  ipcMain.handle("group:activate-note", (_event, id) => windows.activateDockedNote(validId(id)));
  ipcMain.handle("group:close-docked-note", (_event, id) => windows.closeDockedNote(validId(id)));
  ipcMain.handle("shelf:set-expanded", (_event, expanded) => windows.setShelfExpanded(Boolean(expanded)));
  ipcMain.on("shelf:move-start", (event) => windows.beginShelfMove(event.sender));
  ipcMain.on("shelf:move", (event, deltaX, deltaY) => {
    if (validWindowDelta(deltaX) && validWindowDelta(deltaY)) windows.moveShelf(deltaX, deltaY, event.sender);
  });
  ipcMain.on("shelf:move-end", (event) => windows.endShelfMove(event.sender));
  ipcMain.handle("shelf:note-drag-start", (event, id, pointerX, pointerY, sourceBounds) => {
    if (Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
      return windows.beginShelfNoteDrag(validId(id), pointerX, pointerY, validWindowBounds(sourceBounds), event.sender);
    }
    return false;
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
  ipcMain.handle("app:get-info", () => getAppInfo());
  ipcMain.handle("update:get-state", () => updateService.getState());
  ipcMain.handle("update:check", () => updateService.checkForUpdates({ manual: true }));
  ipcMain.handle("update:download", () => updateService.startDownload());
  ipcMain.handle("update:cancel", () => updateService.cancelDownload());
  ipcMain.handle("update:skip", () => updateService.skipLatestVersion());
  ipcMain.handle("update:restart", () => updateService.restartToApply());
  ipcMain.handle("update:open-release-page", () => {
    updateService.openReleasePage();
    return true;
  });
  ipcMain.handle("update:dismiss-apply-result", () => {
    updateService.dismissApplyResult();
    return true;
  });
  ipcMain.handle("update:open-window", () => {
    updateWindow.open();
    return true;
  });
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
        { label: "检查更新", click: openUpdateWindowWithCheck },
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
    if (!focusedWindow) return;
    if (focusedWindow === windows.shelfWindow) {
      if (windows.activeDockedId) focusedWindow.webContents.send("app:command", "close-window");
      return;
    }
    if (focusedWindow === windows.mainWindow) focusedWindow.close();
    else focusedWindow.webContents.send("app:command", "close-window");
    return;
  }
  if (!NOTE_COMMANDS.has(id) || !focusedWindow || focusedWindow === windows.mainWindow) return;
  if (focusedWindow === windows.shelfWindow && !windows.activeDockedId) return;
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

function getAppInfo() {
  return {
    name: app.getName(),
    version: runtimeVersion,
    buildVersion: runtimeVersion,
    devBuild: isDevBuildVersion(runtimeVersion),
    fakeBuild: isFakeBuildVersion(runtimeVersion),
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    logFile,
  };
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
      startHidden: preferences.startHidden,
      closeMainToTray: preferences.closeMainToTray,
      hideDockOnMainClose: preferences.hideDockOnMainClose,
      hideDockOnMainCloseSupported: process.platform === "darwin",
      verboseLogging: preferences.verboseLogging,
      updateAutoCheck: preferences.update.autoCheck,
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
  for (const key of ["showMainOnLogin", "startHidden", "closeMainToTray", "hideDockOnMainClose", "defaultNotePinned"]) {
    if (typeof patch[key] === "boolean") preferencesPatch[key] = patch[key];
  }
  if (typeof patch.defaultNoteColor === "string") preferencesPatch.defaultNoteColor = patch.defaultNoteColor;
  if (Object.hasOwn(patch, "verboseLogging")) {
    preferencesPatch.verboseLogging = Boolean(patch.verboseLogging);
    setLogLevel(preferencesPatch.verboseLogging ? "debug" : "info");
  }
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
  if (Object.hasOwn(patch, "updateAutoCheck")) updateService.setAutoCheck(Boolean(patch.updateAutoCheck));
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
  trayController?.refresh();
}

function broadcastUpdateState(state) {
  windows?.broadcast("update:state", state);
  updateWindow?.broadcast("update:state", state);
}

function openUpdateWindowWithCheck() {
  updateWindow.open();
  void updateService.checkForUpdates({ manual: true });
}

function notifyUpdate({ title, body }) {
  if (!Notification.isSupported()) {
    log.debug("系统通知不可用, 跳过新版本提醒");
    return;
  }
  try {
    const notification = new Notification({ title, body });
    notification.on("click", () => updateWindow?.open());
    notification.show();
  } catch (error) {
    log.warn("发送系统通知失败", { message: error instanceof Error ? error.message : "未知错误" });
  }
}

function openUpdateArtifact(artifactPath) {
  if (!artifactPath) return;
  log.info("更新需要手动完成安装", { artifactPath });
  shell.showItemInFolder(artifactPath);
}

function openReleasePage(url) {
  void shell.openExternal(url).catch((error) => {
    log.warn("打开发布页面失败", { url, message: error instanceof Error ? error.message : "未知错误" });
  });
}

// 替换已经完成后以新版本重启: 先释放单实例锁, 避免新进程抢锁失败直接退出.
function restartApplication(executable) {
  const target = typeof executable === "string" && executable.length > 0 ? executable : process.execPath;
  log.info("以新版本重启应用", { target });
  releaseSingleInstanceLock({ app });
  try {
    const child = spawn(target, [], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (error) {
    log.error("拉起新版本失败", error);
  }
  app.quit();
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
    trayController = createAppTray({
      appName: app.getName(),
      version: runtimeVersion,
      iconPath,
      templatePath: path.join(currentDir, "assets", "trayTemplate.png"),
      retinaTemplatePath: path.join(currentDir, "assets", "trayTemplate@2x.png"),
      isAutoCheckEnabled: () => store.getPreferences().update.autoCheck,
      onOpenMainWindow: () => {
        if (quitStarted) return;
        log.info("从系统托盘打开主窗口");
        windows.openMainWindow();
      },
      onCreateNote: () => {
        if (quitStarted) return;
        const note = windows.createNearFocused();
        log.info("从系统托盘新建便签", { id: note.id });
      },
      onCheckUpdates: () => {
        if (quitStarted) return;
        openUpdateWindowWithCheck();
      },
      onToggleAutoCheck: (checked) => {
        if (quitStarted) return;
        updateGeneralSettings({ updateAutoCheck: checked });
      },
      onQuit: () => {
        if (quitStarted) return;
        log.info("从系统托盘退出 Pinote");
        app.quit();
      },
    });
    tray = trayController?.tray ?? null;
    windows.setTrayAvailable(Boolean(trayController));
  } catch (error) {
    tray = null;
    trayController = null;
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

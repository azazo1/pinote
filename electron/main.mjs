import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import log from "electron-log/main.js";
import { NoteStore } from "./note-store.mjs";
import { WindowManager } from "./window-manager.mjs";
import { SyncService } from "./sync-service.mjs";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = process.env.VITE_DEV_SERVER_URL ? "debug" : "info";

let store;
let windows;
let sync;
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
  for (const note of store.state.notes) windows.open(note);
  windows.restoreDockedMode();
  sync.initialize();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createNearFocused();
  });
}).catch((error) => {
  log.error("Pinote 启动失败", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  sync?.stop();
  void Promise.resolve(store?.save()).finally(() => {
    quitReady = true;
    app.quit();
  });
});

function registerIpc() {
  ipcMain.handle("note:get", (_event, id) => ({
    note: store.getRenderableNote(validId(id)),
    group: { docked: store.state.groupDocked, mode: store.state.dockMode },
    capabilities: windows.getCapabilities(),
  }));
  ipcMain.handle("note:update", (_event, id, patch) => {
    const note = store.updateContent(validId(id), sanitizePatch(patch));
    windows.broadcastNoteList();
    sync.schedule();
    return note;
  });
  ipcMain.handle("note:create", () => {
    const note = windows.createNearFocused();
    sync.schedule();
    return note;
  });
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
  ipcMain.handle("window:toggle-collapse", (_event, id) => windows.toggleCollapse(validId(id)));
  ipcMain.on("window:move", (_event, id, x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) windows.move(validId(id), x, y);
  });
  ipcMain.handle("window:set-pinned", (_event, id, pinned) => windows.setPinned(validId(id), Boolean(pinned)));
  ipcMain.handle("group:toggle-dock", () => windows.toggleGroupDock());
  ipcMain.on("group:reveal", () => windows.revealGroup());
  ipcMain.on("group:hide", () => windows.scheduleHideGroup());
  ipcMain.handle("notes:list", () => store.listSummaries());
  ipcMain.handle("group:activate-note", (_event, id) => windows.activateDockedNote(validId(id)));
  ipcMain.on("shelf:set-expanded", (_event, expanded) => windows.setShelfExpanded(Boolean(expanded)));
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
        { label: "侧边吸附", accelerator: "CommandOrControl+Shift+D", click: () => windows.toggleGroupDock() },
      ],
    },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== "object") return {};
  const safe = {};
  if (typeof patch.title === "string") safe.title = patch.title.slice(0, 200);
  if (typeof patch.markdown === "string") safe.markdown = patch.markdown.slice(0, 2_000_000);
  if (typeof patch.color === "string") safe.color = patch.color.slice(0, 32);
  return safe;
}

function validId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new Error("便签 id 无效");
  return value;
}

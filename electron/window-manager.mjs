import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { RendererFlushCoordinator } from "./sync/renderer-flush.mjs";
import { snapBounds } from "./windowing/snap-bounds.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const COLLAPSED_HEIGHT = 22;
const COLLAPSED_WIDTH = 253;
const SHELF_COLLAPSED_SIZE = 36;
const SHELF_EXPANDED_WIDTH = 200;
const SHELF_MARGIN = 8;
const WINDOW_ANIMATION_MS = 110;
const SHELF_ANIMATION_MS = 90;
const ANIMATION_FRAME_MS = 16;
const SHELF_HIDE_DELAY_MS = 700;
const SHELF_POSITION_SAVE_DELAY_MS = 120;
const WINDOW_STATE_SAVE_DELAY_MS = 120;
const MAIN_WINDOW_WIDTH = 640;
const MAIN_WINDOW_HEIGHT = 500;

export class WindowManager {
  constructor(store) {
    this.store = store;
    this.windows = new Map();
    this.mainWindow = null;
    this.shelfWindow = null;
    this.shelfExpanded = false;
    this.activeDockedId = null;
    this.hideTimer = null;
    this.shelfPositionSaveTimer = null;
    this.animations = new Map();
    this.animatingWindows = new Set();
    this.boundsSaveTimers = new Map();
    this.resizeSessions = new Map();
    this.rendererFlush = new RendererFlushCoordinator(1_200, (pending) => {
      log.warn("等待便签保存超时", { pending });
    });
    this.wayland = isWaylandSession();
    this.trayAvailable = false;
    this.quitting = false;
    this.ignoreMainActivationUntil = 0;

    screen.on("display-removed", () => this.constrainAllWindows());
    screen.on("display-metrics-changed", () => this.constrainAllWindows());
  }

  getCapabilities() {
    return { platform: process.platform, wayland: this.wayland };
  }

  flushPendingNotes() {
    const targets = new Map(
      [...this.windows.values()]
        .filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed())
        .map((window) => [window.webContents.id, window.webContents]),
    );
    return this.rendererFlush.request([...targets.keys()], (targetId, requestId) => {
      const webContents = targets.get(targetId);
      if (!webContents || webContents.isDestroyed()) {
        this.rendererFlush.complete(requestId, targetId);
        return;
      }
      try {
        webContents.send("note:flush-request", requestId);
      } catch (error) {
        log.warn("请求便签保存失败", { targetId, message: error instanceof Error ? error.message : "未知错误" });
        this.rendererFlush.complete(requestId, targetId, false);
      }
    });
  }

  completePendingNoteFlush(webContentsId, requestId, succeeded) {
    if (!Number.isInteger(webContentsId) || typeof requestId !== "string") return false;
    return this.rendererFlush.complete(requestId, webContentsId, succeeded === true);
  }

  getDockMode() {
    return this.wayland ? "inline" : "shelf";
  }

  getGroupState() {
    const mode = this.getDockMode();
    const dockedIds = this.store.listDockedNotes(mode).map((note) => note.id);
    return {
      mode,
      activeId: dockedIds.includes(this.activeDockedId) ? this.activeDockedId : null,
      dockedIds,
    };
  }

  setTrayAvailable(available) {
    this.trayAvailable = Boolean(available);
  }

  prepareToQuit() {
    this.quitting = true;
    this.cancelHideGroup();
    clearTimeout(this.shelfPositionSaveTimer);
    this.shelfPositionSaveTimer = null;
    const pendingWindowIds = new Set([...this.boundsSaveTimers.keys(), ...this.resizeSessions.keys()]);
    for (const id of pendingWindowIds) this.flushPendingBounds(id);
    this.resizeSessions.clear();
  }

  cancelQuit() {
    this.quitting = false;
  }

  shouldOpenMainWindowOnActivate() {
    return !this.quitting && Date.now() >= this.ignoreMainActivationUntil;
  }

  openMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
      log.info("已打开主窗口");
      return this.mainWindow;
    }

    const window = new BrowserWindow({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
      minWidth: 480,
      minHeight: 360,
      show: false,
      title: "Pinote",
      backgroundColor: "#f5f5f2",
      webPreferences: rendererPreferences(),
    });
    this.mainWindow = window;
    this.loadRenderer(window, { view: "main" });
    window.once("ready-to-show", () => window.show());
    window.webContents.on("did-finish-load", () => {
      window.webContents.send("notes:list", this.store.listSummaries());
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      log.error("主窗口渲染进程退出", { reason: details.reason });
    });
    window.on("close", (event) => {
      if (this.quitting || !this.trayAvailable) return;
      event.preventDefault();
      this.ignoreMainActivationUntil = Date.now() + 350;
      window.hide();
      log.info("主窗口已隐藏到系统托盘");
    });
    if (process.platform === "win32") {
      window.on("query-session-end", () => this.prepareToQuit());
      window.on("session-end", () => this.prepareToQuit());
    }
    window.on("closed", () => {
      if (this.mainWindow === window) this.mainWindow = null;
    });
    log.info("已创建主窗口");
    return window;
  }

  open(note) {
    const existing = this.windows.get(note.id);
    if (existing && !existing.isDestroyed()) return existing;
    if (existing) this.windows.delete(note.id);
    const state = this.store.getWindowState(note.id);
    const display = this.findDisplay(state);
    const bounds = this.clampBounds(state.bounds, display.workArea);
    const initialBounds = state.collapsed
      ? { ...bounds, x: bounds.x + bounds.width - COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
      : bounds;
    const window = new BrowserWindow({
      ...initialBounds,
      minWidth: COLLAPSED_WIDTH,
      minHeight: state.collapsed ? COLLAPSED_HEIGHT : 180,
      maxWidth: 760,
      maxHeight: 900,
      frame: false,
      transparent: true,
      show: false,
      resizable: this.wayland && !state.collapsed,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: state.pinned,
      hasShadow: true,
      backgroundColor: "#00000000",
      webPreferences: rendererPreferences(),
    });

    this.windows.set(note.id, window);
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    this.applyPinnedLevel(window, state.pinned);
    this.loadRenderer(window, { noteId: note.id });

    window.once("ready-to-show", () => {
      if (!this.store.isDocked(note.id) || (this.getDockMode() === "inline" && this.activeDockedId === note.id)) {
        window.show();
      }
    });
    window.on("resize", () => this.schedulePersistBounds(note.id));
    window.on("move", () => this.handleWindowMove(note.id));
    window.on("close", () => this.flushPendingBounds(note.id));
    window.on("closed", () => {
      this.cancelAnimation(window);
      this.cancelPendingBounds(note.id);
      this.resizeSessions.delete(note.id);
      if (this.windows.get(note.id) === window) this.windows.delete(note.id);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      this.resizeSessions.delete(note.id);
      this.flushPendingBounds(note.id);
      log.error("便签渲染进程退出", { id: note.id, reason: details.reason });
    });
    return window;
  }

  openNote(id) {
    const note = this.store.getNote(id);
    if (!note) return null;
    this.store.updateWindow(id, { open: true });
    const existing = this.windows.get(id);
    const window = this.open(note);
    const activate = () => {
      if (window.isDestroyed()) return;
      if (this.store.isDocked(id)) {
        this.activateDockedNote(id);
      } else {
        window.show();
        window.focus();
      }
    };
    if (!existing || existing.isDestroyed()) window.once("ready-to-show", activate);
    else activate();
    this.broadcastNoteList();
    log.info("已打开便签窗口", { id });
    return this.store.getRenderableNote(id);
  }

  closeNote(id) {
    if (!this.store.updateWindow(id, { open: false })) return false;
    const window = this.windows.get(id);
    if (this.activeDockedId === id) this.activeDockedId = null;
    this.flushPendingBounds(id);
    this.windows.delete(id);
    window?.hide();
    if (window) {
      setImmediate(() => {
        if (!window.isDestroyed()) window.close();
      });
    }
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
    log.info("已关闭便签窗口", { id });
    return true;
  }

  restoreDockedMode() {
    const mode = this.getDockMode();
    for (const note of this.store.listDockedNotes()) {
      if (note.dockState !== mode) this.store.setDockState(note.id, mode);
    }
    const dockedIds = this.store.listDockedNotes(mode).map((note) => note.id);
    if (dockedIds.length === 0) {
      this.destroyShelfWindow();
      this.sendGroupState();
      return;
    }
    if (mode === "shelf") {
      this.activeDockedId = null;
      for (const id of dockedIds) this.windows.get(id)?.hide();
      this.ensureShelfWindow();
    } else {
      const firstId = dockedIds.find((id) => {
        const window = this.windows.get(id);
        return window && !window.isDestroyed();
      }) ?? null;
      this.activeDockedId = firstId;
      for (const id of dockedIds) {
        const window = this.windows.get(id);
        if (!window || window.isDestroyed()) continue;
        if (id === firstId) window.showInactive();
        else window.hide();
      }
    }
    this.sendGroupState();
  }

  createNearFocused() {
    const focused = BrowserWindow.getFocusedWindow();
    const bounds = focused && focused !== this.shelfWindow && focused !== this.mainWindow ? focused.getBounds() : null;
    const note = this.store.createNote({
      x: bounds ? bounds.x + 28 : undefined,
      y: bounds ? bounds.y + 28 : undefined,
    });
    this.open(note);
    this.broadcastNoteList();
    return note;
  }

  toggleCollapse(id) {
    const state = this.store.getWindowState(id);
    const window = this.windows.get(id);
    if (!window) return;
    const bounds = window.getBounds();
    const collapsed = !state.collapsed;
    const docked = this.store.isDocked(id);
    if (collapsed) {
      this.store.updateWindow(id, {
        bounds: docked
          ? { ...state.bounds, height: Math.max(state.bounds.height, bounds.height) }
          : { ...bounds, height: Math.max(state.bounds.height, bounds.height) },
        collapsed: true,
      });
      window.setMinimumSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT);
      this.animateBounds(window, {
        x: bounds.x + bounds.width - COLLAPSED_WIDTH,
        y: bounds.y,
        width: COLLAPSED_WIDTH,
        height: COLLAPSED_HEIGHT,
      }, WINDOW_ANIMATION_MS, () => {
        window.setResizable(false);
      });
    } else {
      const target = {
        x: bounds.x + bounds.width - state.bounds.width,
        y: bounds.y,
        width: state.bounds.width,
        height: state.bounds.height,
      };
      this.store.updateWindow(id, { bounds: docked ? state.bounds : target, collapsed: false });
      window.setResizable(this.wayland);
      this.animateBounds(window, target, WINDOW_ANIMATION_MS, () => {
        window.setMinimumSize(COLLAPSED_WIDTH, 180);
        window.setResizable(this.wayland);
      });
    }
    window.webContents.send("note:collapsed", collapsed);
    log.info(collapsed ? "已收起便签" : "已展开便签", { id });
  }

  move(id, x, y) {
    const window = this.windows.get(id);
    if (!window || window.isDestroyed() || this.wayland) return;
    if (this.store.isDocked(id)) this.detachDockedNote(id, { restoreBounds: false });
    const current = window.getBounds();
    const proposed = {
      x: Math.round(x),
      y: Math.round(y),
      width: current.width,
      height: current.height,
    };
    const display = screen.getDisplayMatching(proposed);
    const targets = [];
    for (const [otherId, otherWindow] of this.windows) {
      if (otherId === id || otherWindow.isDestroyed() || !otherWindow.isVisible()) continue;
      if (this.store.isDocked(otherId)) continue;
      const bounds = otherWindow.getBounds();
      const otherDisplay = screen.getDisplayMatching(bounds);
      if (String(otherDisplay.id) !== String(display.id)) continue;
      targets.push(bounds);
    }
    const snapped = snapBounds(proposed, targets, display.workArea);
    window.setPosition(snapped.x, snapped.y);
  }

  resize(id, edge, requestedSize, sender) {
    const window = this.windows.get(id);
    const state = this.store.getWindowState(id);
    const session = this.resizeSessions.get(id);
    if (
      this.wayland ||
      !window ||
      window.isDestroyed() ||
      window.webContents !== sender ||
      session?.senderId !== sender.id ||
      state.collapsed
    ) return;
    if (this.store.isDocked(id)) this.detachDockedNote(id, { restoreBounds: false });

    const width = clampValue(requestedSize.width, COLLAPSED_WIDTH, 760);
    const height = clampValue(requestedSize.height, 180, 900);
    const fromLeft = edge.includes("w");
    const fromTop = edge.includes("n");
    window.setBounds({
      x: fromLeft ? session.bounds.x + session.bounds.width - width : session.bounds.x,
      y: fromTop ? session.bounds.y + session.bounds.height - height : session.bounds.y,
      width,
      height,
    }, false);
  }

  beginResize(id, sender) {
    const window = this.windows.get(id);
    if (
      this.wayland ||
      !window ||
      window.isDestroyed() ||
      window.webContents !== sender ||
      this.store.getWindowState(id).collapsed
    ) return;
    this.cancelAnimation(window);
    this.cancelPendingBounds(id);
    window.setMinimumSize(COLLAPSED_WIDTH, 180);
    this.resizeSessions.set(id, { senderId: sender.id, bounds: window.getBounds() });
  }

  endResize(id, sender) {
    if (this.resizeSessions.get(id)?.senderId !== sender.id) return;
    this.resizeSessions.delete(id);
    this.flushPendingBounds(id);
  }

  handleWindowMove(id) {
    const window = this.windows.get(id);
    if (!window || window.isDestroyed()) return;
    if (
      this.wayland &&
      this.store.getDockState(id) === "inline" &&
      this.activeDockedId === id &&
      !this.animatingWindows.has(window.id)
    ) {
      this.detachDockedNote(id, { restoreBounds: false });
    }
    this.schedulePersistBounds(id);
  }

  setPinned(id, pinned) {
    const window = this.windows.get(id);
    if (!window) return;
    this.applyPinnedLevel(window, Boolean(pinned));
    this.store.updateWindow(id, { pinned: Boolean(pinned) });
    this.broadcastNoteList();
    log.info(pinned ? "便签已置顶" : "便签已取消置顶", { id });
  }

  applyPinnedLevel(window, pinned) {
    window.setAlwaysOnTop(Boolean(pinned), "floating");
  }

  remove(id) {
    const window = this.windows.get(id);
    if (!this.store.deleteNote(id)) return;
    this.cancelPendingBounds(id);
    this.resizeSessions.delete(id);
    window?.destroy();
    this.windows.delete(id);
    if (this.activeDockedId === id) this.activeDockedId = null;
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
  }

  toggleNoteDock(id) {
    if (!this.store.getNote(id)) return { note: null, group: this.getGroupState() };
    if (this.store.isDocked(id)) this.detachDockedNote(id, { restoreBounds: true });
    else this.dockNote(id);
    return { note: this.store.getRenderableNote(id), group: this.getGroupState() };
  }

  dockNote(id) {
    const note = this.store.getNote(id);
    if (!note || this.store.isDocked(id)) return false;
    let window = this.windows.get(id);
    if (!window || window.isDestroyed()) {
      this.store.updateWindow(id, { open: true });
      window = this.open(note);
    }
    this.persistBounds(id);
    const mode = this.getDockMode();
    this.store.setDockState(id, mode);
    this.cancelHideGroup();
    if (mode === "shelf") {
      window.hide();
      this.ensureShelfWindow();
    } else {
      if (this.activeDockedId && this.activeDockedId !== id && this.store.isDocked(this.activeDockedId)) {
        this.windows.get(this.activeDockedId)?.hide();
      }
      this.activeDockedId = id;
      window.show();
      window.focus();
    }
    this.broadcastNoteList();
    this.sendGroupState();
    if (mode === "shelf") this.scheduleHideGroup();
    log.info("便签已加入侧边收纳", { id, mode });
    return true;
  }

  detachDockedNote(id, { restoreBounds = true } = {}) {
    const previousMode = this.store.getDockState(id);
    if (previousMode !== "shelf" && previousMode !== "inline") return false;
    const window = this.windows.get(id);
    if (window && !window.isDestroyed()) this.cancelAnimation(window);
    this.store.setDockState(id, "free");
    if (this.activeDockedId === id) this.activeDockedId = null;
    if (restoreBounds) this.restoreSavedPosition(id, true);
    else if (window && !window.isDestroyed()) window.show();
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
    if (previousMode === "shelf" && this.store.listDockedNotes("shelf").length > 0) this.scheduleHideGroup();
    log.info("便签已离开侧边收纳", { id, previousMode, restoreBounds });
    return true;
  }

  reconcileDockSurface() {
    const mode = this.getDockMode();
    const dockedIds = this.store.listDockedNotes(mode).map((note) => note.id);
    if (dockedIds.length === 0) {
      this.activeDockedId = null;
      this.destroyShelfWindow();
      return;
    }
    if (mode === "shelf") {
      if (!dockedIds.includes(this.activeDockedId)) this.activeDockedId = null;
      this.ensureShelfWindow();
      return;
    }

    this.destroyShelfWindow();
    if (!dockedIds.includes(this.activeDockedId)) {
      this.activeDockedId = dockedIds.find((id) => {
        const window = this.windows.get(id);
        return window && !window.isDestroyed();
      }) ?? null;
    }
    for (const id of dockedIds) {
      const window = this.windows.get(id);
      if (!window || window.isDestroyed()) continue;
      if (id === this.activeDockedId) window.showInactive();
      else window.hide();
    }
  }

  destroyShelfWindow() {
    this.cancelHideGroup();
    this.shelfExpanded = false;
    const shelf = this.shelfWindow;
    this.shelfWindow = null;
    if (!shelf || shelf.isDestroyed()) return;
    this.cancelAnimation(shelf);
    shelf.destroy();
  }

  ensureShelfWindow() {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return null;
    if (this.shelfWindow && !this.shelfWindow.isDestroyed()) return this.shelfWindow;
    const display = this.findShelfDisplay();
    const bounds = this.shelfBounds(display, false);
    const size = SHELF_COLLAPSED_SIZE;
    const options = {
      ...bounds,
      minWidth: size,
      minHeight: size,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: "#00000000",
      webPreferences: rendererPreferences(),
    };
    if (process.platform === "darwin") options.type = "panel";
    const shelf = new BrowserWindow(options);
    this.shelfWindow = shelf;
    if (process.platform === "darwin") {
      shelf.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    this.loadRenderer(shelf, { view: "shelf" });
    shelf.once("ready-to-show", () => {
      if (this.shelfWindow === shelf && !shelf.isDestroyed() && this.store.listDockedNotes("shelf").length > 0) {
        shelf.showInactive();
      }
    });
    shelf.on("closed", () => {
      if (this.shelfWindow === shelf) this.shelfWindow = null;
    });
    return shelf;
  }

  setShelfExpanded(expanded) {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return;
    this.cancelHideGroup();
    const shelf = this.ensureShelfWindow();
    if (!shelf) return;
    const display = this.findShelfDisplay();
    const target = this.shelfBounds(display, expanded);
    this.shelfExpanded = expanded;
    shelf.webContents.send("shelf:expanded", expanded);
    this.animateBounds(shelf, target, SHELF_ANIMATION_MS);
  }

  moveShelf(targetTop) {
    if (!Number.isFinite(targetTop) || this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) {
      return false;
    }
    this.cancelHideGroup();
    const shelf = this.ensureShelfWindow();
    if (!shelf) return false;
    const current = shelf.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: current.x + Math.round(current.width / 2),
      y: Math.round(targetTop + current.height / 2),
    });
    const target = this.shelfBounds(display, this.shelfExpanded);
    const area = display.workArea;
    target.y = clampValue(Math.round(targetTop), area.y, area.y + area.height - target.height);
    const normalizedCenter = clampValue(
      (target.y + target.height / 2 - area.y) / area.height,
      0,
      1,
    );
    const previousDisplayId = this.store.state.shelf.displayId;
    this.store.setShelfPosition(display.id, normalizedCenter, false);
    this.scheduleShelfPositionSave();
    this.cancelAnimation(shelf);
    shelf.setBounds(target, false);
    if (String(previousDisplayId) !== String(display.id)) {
      log.info("侧边架已移动到显示器", { displayId: display.id });
    }
    return true;
  }

  scheduleShelfPositionSave() {
    clearTimeout(this.shelfPositionSaveTimer);
    this.shelfPositionSaveTimer = setTimeout(() => {
      this.shelfPositionSaveTimer = null;
      void this.store.save();
    }, SHELF_POSITION_SAVE_DELAY_MS);
  }

  revealGroup() {
    this.cancelHideGroup();
    if (this.getDockMode() === "shelf") this.setShelfExpanded(true);
  }

  cancelHideGroup() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  scheduleHideGroup() {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return;
    this.cancelHideGroup();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.store.listDockedNotes("shelf").length === 0) {
        this.destroyShelfWindow();
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      const activeWindow = this.activeDockedId && this.store.getDockState(this.activeDockedId) === "shelf"
        ? this.windows.get(this.activeDockedId)
        : null;
      const visibleWindows = [this.shelfWindow, activeWindow].filter(Boolean);
      const hovered = visibleWindows.some((window) => !window.isDestroyed() && contains(window.getBounds(), cursor));
      if (hovered) return;
      activeWindow?.hide();
      this.activeDockedId = null;
      this.setShelfExpanded(false);
    }, SHELF_HIDE_DELAY_MS);
  }

  activateDockedNote(id) {
    const mode = this.getDockMode();
    if (this.store.getDockState(id) !== mode) return;
    this.cancelHideGroup();
    let window = this.windows.get(id);
    if (!window || window.isDestroyed()) {
      const note = this.store.getNote(id);
      if (!note) return;
      this.store.updateWindow(id, { open: true });
      window = this.open(note);
      window.once("ready-to-show", () => this.activateDockedNote(id));
      this.broadcastNoteList();
      return this.store.getRenderableNote(id);
    }
    if (this.activeDockedId && this.activeDockedId !== id && this.store.isDocked(this.activeDockedId)) {
      this.windows.get(this.activeDockedId)?.hide();
    }
    this.activeDockedId = id;
    if (mode === "inline") {
      window.show();
      window.focus();
      this.sendGroupState();
      return;
    }

    this.setShelfExpanded(true);
    const shelf = this.ensureShelfWindow();
    if (!shelf) return;
    const display = screen.getDisplayMatching(shelf.getBounds());
    const state = this.store.getWindowState(id);
    const height = state.collapsed ? COLLAPSED_HEIGHT : state.bounds.height;
    const bounds = this.clampBounds({
      x: shelf.getBounds().x - state.bounds.width - 10,
      y: Math.max(display.workArea.y + 12, screen.getCursorScreenPoint().y - 32),
      width: state.bounds.width,
      height,
    }, display.workArea);
    window.setBounds(bounds, false);
    window.show();
    window.focus();
    return this.store.getRenderableNote(id);
  }

  reconcileRemoteState() {
    const activeIds = new Set(this.store.state.notes.map((note) => note.id));
    for (const [id, window] of this.windows) {
      if (!activeIds.has(id) || !this.store.getWindowState(id).open) {
        window.destroy();
        this.windows.delete(id);
        if (this.activeDockedId === id) this.activeDockedId = null;
      }
    }
    for (const note of this.store.state.notes) {
      const state = this.store.getWindowState(note.id);
      if (!state.open) continue;
      const window = this.windows.get(note.id);
      if (!window || window.isDestroyed()) {
        this.open(note);
        continue;
      }
      this.applyPinnedLevel(window, state.pinned);
      window.webContents.send("note:remote", this.store.getRenderableNote(note.id));
      if (this.store.isDocked(note.id) && note.id !== this.activeDockedId) window.hide();
      else if (!this.store.isDocked(note.id) && !window.isVisible()) window.showInactive();
    }
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
  }

  restoreSavedPositions() {
    for (const id of this.windows.keys()) {
      if (!this.store.isDocked(id)) this.restoreSavedPosition(id);
    }
  }

  restoreSavedPosition(id, focus = false) {
    const window = this.windows.get(id);
    if (!window || window.isDestroyed() || this.store.isDocked(id)) return;
    const state = this.store.getWindowState(id);
    const display = this.findDisplay(state);
    const bounds = this.clampBounds(state.bounds, display.workArea);
    const target = state.collapsed
      ? { ...bounds, x: bounds.x + bounds.width - COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
      : bounds;
    window.setMinimumSize(COLLAPSED_WIDTH, state.collapsed ? COLLAPSED_HEIGHT : 180);
    window.setResizable(this.wayland && !state.collapsed);
    this.applyPinnedLevel(window, state.pinned);
    window.show();
    if (focus) window.focus();
    this.animateBounds(window, target);
  }

  constrainAllWindows() {
    this.restoreSavedPositions();
    if (this.getDockMode() === "shelf" && this.store.listDockedNotes("shelf").length > 0) {
      this.setShelfExpanded(this.shelfExpanded);
    } else {
      this.reconcileDockSurface();
    }
  }

  persistBounds(id) {
    if (this.store.isDocked(id)) return;
    const window = this.windows.get(id);
    if (!window || window.isDestroyed()) return;
    if (this.animatingWindows.has(window.id)) return;
    const state = this.store.getWindowState(id);
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    this.store.updateWindow(id, {
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      bounds: state.collapsed
        ? { ...state.bounds, x: bounds.x + bounds.width - state.bounds.width, y: bounds.y }
        : bounds,
    });
  }

  schedulePersistBounds(id) {
    if (this.store.isDocked(id) || this.resizeSessions.has(id)) return;
    clearTimeout(this.boundsSaveTimers.get(id));
    this.boundsSaveTimers.set(id, setTimeout(() => {
      this.boundsSaveTimers.delete(id);
      this.persistBounds(id);
    }, WINDOW_STATE_SAVE_DELAY_MS));
  }

  flushPendingBounds(id) {
    this.cancelPendingBounds(id);
    this.persistBounds(id);
  }

  cancelPendingBounds(id) {
    clearTimeout(this.boundsSaveTimers.get(id));
    this.boundsSaveTimers.delete(id);
  }

  animateBounds(window, target, duration = WINDOW_ANIMATION_MS, onComplete) {
    if (!window || window.isDestroyed()) return;
    this.cancelAnimation(window);
    const start = window.getBounds();
    if (sameBounds(start, target)) {
      window.setBounds(target, false);
      onComplete?.();
      return;
    }

    const animation = { timer: null };
    const startedAt = performance.now();
    this.animations.set(window.id, animation);
    this.animatingWindows.add(window.id);

    const tick = () => {
      if (window.isDestroyed() || this.animations.get(window.id) !== animation) return;
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.setBounds(interpolateBounds(start, target, eased), false);
      if (progress < 1) {
        animation.timer = setTimeout(tick, ANIMATION_FRAME_MS);
        return;
      }
      this.animations.delete(window.id);
      this.animatingWindows.delete(window.id);
      onComplete?.();
    };

    tick();
  }

  cancelAnimation(window) {
    const animation = this.animations.get(window.id);
    if (animation?.timer) clearTimeout(animation.timer);
    this.animations.delete(window.id);
    this.animatingWindows.delete(window.id);
  }

  findDisplay(state) {
    const displays = screen.getAllDisplays();
    const saved = displays.find((display) => String(display.id) === String(state.displayId));
    if (saved) return saved;
    const bounds = state.bounds;
    if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) return screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    return screen.getPrimaryDisplay();
  }

  findShelfDisplay() {
    const displays = screen.getAllDisplays();
    const savedId = this.store.state.shelf.displayId;
    const saved = displays.find((display) => String(display.id) === String(savedId));
    if (saved) return saved;
    const fallback = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.store.setShelfPosition(fallback.id, this.store.getShelfPosition(fallback.id));
    if (savedId !== null) log.info("侧边架显示器已恢复", { displayId: fallback.id });
    return fallback;
  }

  shelfBounds(display, expanded) {
    const area = display.workArea;
    const width = Math.min(expanded ? SHELF_EXPANDED_WIDTH : SHELF_COLLAPSED_SIZE, area.width);
    const desiredHeight = expanded ? this.shelfExpandedHeight(area) : SHELF_COLLAPSED_SIZE;
    const height = Math.min(desiredHeight, area.height);
    const normalizedCenter = this.store.getShelfPosition(display.id);
    const centerY = area.y + normalizedCenter * area.height;
    return {
      x: Math.max(area.x, area.x + area.width - width - (expanded ? SHELF_MARGIN : 0)),
      y: clampValue(Math.round(centerY - height / 2), area.y, area.y + area.height - height),
      width,
      height,
    };
  }

  clampBounds(bounds, area) {
    const width = Math.min(bounds.width ?? 253, area.width);
    const height = Math.min(bounds.height ?? 220, area.height);
    const defaultX = area.x + area.width - width - 48;
    const defaultY = area.y + 48;
    return {
      x: Math.max(area.x, Math.min(bounds.x ?? defaultX, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(bounds.y ?? defaultY, area.y + area.height - COLLAPSED_HEIGHT)),
      width,
      height,
    };
  }

  sendGroupState() {
    this.broadcast("group:state", this.getGroupState());
  }

  broadcastNoteList() {
    this.broadcast("notes:list", this.store.listSummaries());
    if (this.shelfExpanded && this.store.listDockedNotes("shelf").length > 0) this.setShelfExpanded(true);
  }

  shelfExpandedHeight(area) {
    const desired = 42 + this.store.listDockedNotes("shelf").length * 32;
    return Math.min(area.height - SHELF_MARGIN * 2, Math.max(110, Math.min(360, desired)));
  }

  broadcast(channel, payload) {
    const targets = [...this.windows.values(), this.shelfWindow, this.mainWindow];
    for (const window of targets) {
      if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
    }
  }

  loadRenderer(window, query) {
    if (process.env.VITE_DEV_SERVER_URL) {
      void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${new URLSearchParams(query)}`);
    } else {
      void window.loadFile(path.join(currentDir, "..", "dist", "index.html"), { query });
    }
  }
}

function sameBounds(left, right) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function interpolateBounds(start, target, progress) {
  return {
    x: Math.round(start.x + (target.x - start.x) * progress),
    y: Math.round(start.y + (target.y - start.y) * progress),
    width: Math.round(start.width + (target.width - start.width) * progress),
    height: Math.round(start.height + (target.height - start.height) * progress),
  };
}

function rendererPreferences() {
  return {
    preload: path.join(currentDir, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function isWaylandSession() {
  return process.platform === "linux" && (Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland");
}

function contains(bounds, point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

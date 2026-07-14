import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";
import { RendererFlushCoordinator } from "./sync/renderer-flush.mjs";
import { isPointNearBounds, SHELF_DOCK_PROXIMITY } from "./windowing/shelf-proximity.mjs";
import { snapBounds } from "./windowing/snap-bounds.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const COLLAPSED_HEIGHT = 22;
const COLLAPSED_WIDTH = 253;
const SHELF_COLLAPSED_SIZE = 36;
const SHELF_EXPANDED_WIDTH = 200;
const SHELF_MARGIN = 8;
const SHELF_EDGE_SNAP_DISTANCE = 20;
const SHELF_NOTE_TRANSITION_SIZE = 24;
const SHELF_NOTE_TRANSITION_MS = 180;
const SHELF_HOVER_EXPAND_DELAY_MS = 720;
const SHELF_HOVER_POLL_MS = 100;
const WINDOW_ANIMATION_MS = 110;
const SHELF_ANIMATION_MS = SHELF_NOTE_TRANSITION_MS;
const ANIMATION_FRAME_MS = 16;
const SHELF_HIDE_DELAY_MS = 700;
const APP_BLUR_HIDE_DELAY_MS = 80;
const WINDOW_STATE_SAVE_DELAY_MS = 120;
const MAIN_WINDOW_WIDTH = 640;
const MAIN_WINDOW_HEIGHT = 500;

export class WindowManager {
  constructor(store, { requestQuit, showDock, hideDock } = {}) {
    this.store = store;
    this.requestQuit = requestQuit;
    this.showDock = showDock;
    this.hideDock = hideDock;
    this.windows = new Map();
    this.mainWindow = null;
    this.shelfWindow = null;
    this.shelfExpanded = false;
    this.activeDockedId = null;
    this.hideTimer = null;
    this.appBlurTimer = null;
    this.shelfMoveSession = null;
    this.animations = new Map();
    this.animatingWindows = new Set();
    this.boundsSaveTimers = new Map();
    this.resizeSessions = new Map();
    this.moveSessions = new Map();
    this.shelfNoteDragSession = null;
    this.transitioningNotes = new Set();
    this.shelfHoverTimer = null;
    this.shelfHoverStartedAt = null;
    this.shelfDropExpandTimer = null;
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
    this.cancelAppBlurHide();
    this.finishShelfMove(false);
    this.finishShelfNoteDrag(false);
    this.cancelShelfHoverExpansion();
    this.cancelShelfDropExpansion();
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
    this.showDock?.();
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
      if (!this.store.state.preferences.closeMainToTray) {
        event.preventDefault();
        this.requestQuit?.(window);
        return;
      }
      event.preventDefault();
      this.ignoreMainActivationUntil = Date.now() + 350;
      window.hide();
      if (this.store.state.preferences.hideDockOnMainClose) this.hideDock?.();
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

  open(note, openOptions = {}) {
    const existing = this.windows.get(note.id);
    if (existing && !existing.isDestroyed()) return existing;
    if (existing) this.windows.delete(note.id);
    const state = this.store.getWindowState(note.id);
    const display = this.findDisplay(state);
    const bounds = this.clampBounds(state.bounds, display.workArea);
    const initialBounds = state.collapsed
      ? { ...bounds, x: bounds.x + bounds.width - COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
      : bounds;
    const options = {
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
    };
    if (process.platform === "darwin") {
      options.type = "panel";
      options.acceptFirstMouse = true;
    }
    const window = new BrowserWindow(options);

    this.windows.set(note.id, window);
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    this.applyPinnedLevel(window, state.pinned);
    this.loadRenderer(window, {
      noteId: note.id,
      ...(openOptions.initialFocus ? { initialFocus: openOptions.initialFocus } : {}),
    });

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
      this.moveSessions.delete(note.id);
      if (this.shelfNoteDragSession?.id === note.id) this.shelfNoteDragSession = null;
      this.transitioningNotes.delete(note.id);
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
    this.open(note, { initialFocus: "title" });
    this.broadcastNoteList();
    return note;
  }

  createDockedNote() {
    const note = this.store.createNote();
    this.open(note, { initialFocus: "title" });
    this.dockNote(note.id, { persist: false });
    return this.store.getRenderableNote(note.id);
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

  beginMove(id, sender) {
    const window = this.windows.get(id);
    if (
      this.wayland
      || !window
      || window.isDestroyed()
      || window.webContents !== sender
    ) return false;
    this.moveSessions.set(id, {
      senderId: sender.id,
      nearShelf: false,
      previewing: false,
      returning: false,
      released: false,
      fullBounds: window.getBounds(),
    });
    this.cancelAnimation(window);
    this.cancelPendingBounds(id);
    this.cancelHideGroup();
    this.cancelShelfHoverExpansion();
    return true;
  }

  move(id, x, y, pointerX, pointerY, sender) {
    const window = this.windows.get(id);
    const session = this.moveSessions.get(id);
    if (
      !window
      || window.isDestroyed()
      || this.wayland
      || window.webContents !== sender
      || session?.senderId !== sender.id
    ) return false;
    const wasDocked = this.store.isDocked(id);
    if (wasDocked) this.detachDockedNote(id, { restoreBounds: false });
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
    session.fullBounds = { ...snapped, width: proposed.width, height: proposed.height };
    const proximityHysteresis = session.previewing || session.returning ? 16 : 0;
    session.nearShelf = !wasDocked && this.shouldDockAtShelf({ x: pointerX, y: pointerY }, proximityHysteresis);
    if (session.nearShelf) {
      if (!session.previewing) this.beginShelfDockPreview(id, window, session);
      return true;
    }
    if (session.previewing) {
      this.returnFromShelfDockPreview(id, window, session);
      return true;
    }
    if (session.returning) return true;
    window.setPosition(snapped.x, snapped.y);
    return true;
  }

  endMove(id, sender) {
    const session = this.moveSessions.get(id);
    if (session?.senderId !== sender.id) return false;
    this.moveSessions.delete(id);
    if (session.nearShelf && !this.store.isDocked(id)) {
      const docked = this.dockNote(id, { animate: true, persist: false });
      if (docked) log.info("移动便签在侧边球附近松手后已自动收纳", { id });
      return docked;
    }
    if (session.returning) {
      session.released = true;
      return true;
    }
    this.flushPendingBounds(id);
    this.armShelfHoverExpansion();
    this.scheduleHideGroup();
    return true;
  }

  enableWindowFocus(id, sender) {
    const window = this.windows.get(id);
    if (!window || window.isDestroyed() || window.webContents !== sender || window.isFocusable()) return false;
    window.setFocusable(true);
    window.show();
    window.focus();
    return true;
  }

  shouldDockAtShelf(point, proximityHysteresis = 0) {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return false;
    const shelf = this.shelfWindow;
    if (!shelf || shelf.isDestroyed()) return false;
    const display = screen.getDisplayMatching(shelf.getBounds());
    return isPointNearBounds(point, shelf.getBounds(), 8 + proximityHysteresis)
      || isPointNearBounds(point, this.shelfBounds(display, false), SHELF_DOCK_PROXIMITY + proximityHysteresis);
  }

  shelfNoteTransitionBounds(shelf, requestedBounds = null, dropIndex = null) {
    if (requestedBounds) return requestedBounds;
    const display = screen.getDisplayMatching(shelf.getBounds());
    const shelfBounds = this.shelfExpanded ? this.shelfBounds(display, true) : shelf.getBounds();
    const expandedLike = this.shelfExpanded || shelfBounds.width > SHELF_COLLAPSED_SIZE + 16;
    if (expandedLike) {
      const dockedCount = this.store.listDockedNotes("shelf").length;
      const index = Number.isInteger(dropIndex) ? dropIndex : Math.max(0, dockedCount - 1);
      const width = Math.max(SHELF_NOTE_TRANSITION_SIZE, Math.min(SHELF_EXPANDED_WIDTH - 12, shelfBounds.width - 12));
      return {
        x: shelfBounds.x + 6,
        y: clampValue(shelfBounds.y + 40 + index * 32, shelfBounds.y + 6, shelfBounds.y + shelfBounds.height - 32),
        width,
        height: 32,
      };
    }
    const ball = this.shelfBounds(display, false);
    return {
      x: Math.round(ball.x + (ball.width - SHELF_NOTE_TRANSITION_SIZE) / 2),
      y: Math.round(ball.y + (ball.height - SHELF_NOTE_TRANSITION_SIZE) / 2),
      width: SHELF_NOTE_TRANSITION_SIZE,
      height: SHELF_NOTE_TRANSITION_SIZE,
    };
  }

  beginNoteTransition(id, window) {
    this.cancelAnimation(window);
    this.transitioningNotes.add(id);
    window.setMinimumSize(1, 1);
    window.setResizable(false);
    window.setAlwaysOnTop(true, process.platform === "darwin" ? "screen-saver" : "pop-up-menu");
  }

  finishNoteTransition(id, window) {
    this.cancelAnimation(window);
    this.transitioningNotes.delete(id);
    if (!window || window.isDestroyed()) return;
    const state = this.store.getWindowState(id);
    window.setMinimumSize(COLLAPSED_WIDTH, state.collapsed ? COLLAPSED_HEIGHT : 180);
    window.setResizable(this.wayland && !state.collapsed);
    this.applyPinnedLevel(window, state.pinned);
  }

  animateNoteIntoShelf(id, window, shelf, expandAfterDrop = false) {
    this.beginNoteTransition(id, window);
    const target = this.shelfNoteTransitionBounds(shelf);
    window.showInactive();
    window.moveTop();
    this.animateBounds(window, target, SHELF_NOTE_TRANSITION_MS, () => {
      if (!window.isDestroyed()) window.hide();
      this.finishNoteTransition(id, window);
      if (expandAfterDrop) this.scheduleShelfExpansionAfterDrop();
      else this.scheduleHideGroup();
    });
  }

  beginShelfDockPreview(id, window, session) {
    session.previewing = true;
    session.returning = false;
    this.persistBounds(id);
    this.cancelHideGroup();
    this.cancelShelfHoverExpansion();
    this.beginNoteTransition(id, window);
    const shelf = this.shelfWindow;
    if (!shelf || shelf.isDestroyed()) return;
    const dropIndex = this.store.listDockedNotes("shelf").length;
    this.animateBounds(window, this.shelfNoteTransitionBounds(shelf, null, dropIndex), SHELF_NOTE_TRANSITION_MS);
  }

  returnFromShelfDockPreview(id, window, session) {
    session.previewing = false;
    session.returning = true;
    this.cancelAnimation(window);
    const start = window.getBounds();
    const animation = { timer: null };
    const startedAt = performance.now();
    this.animations.set(window.id, animation);
    this.animatingWindows.add(window.id);

    const tick = () => {
      if (window.isDestroyed() || this.animations.get(window.id) !== animation) return;
      const progress = Math.min(1, (performance.now() - startedAt) / SHELF_NOTE_TRANSITION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.setBounds(interpolateBounds(start, session.fullBounds, eased), false);
      if (progress < 1) {
        animation.timer = setTimeout(tick, ANIMATION_FRAME_MS);
        return;
      }
      this.animations.delete(window.id);
      this.animatingWindows.delete(window.id);
      session.returning = false;
      window.setBounds(session.fullBounds, false);
      this.finishNoteTransition(id, window);
      if (session.released) {
        this.persistBounds(id);
        this.armShelfHoverExpansion();
        this.scheduleHideGroup();
      }
    };

    tick();
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

  setNoteArchived(id, archived) {
    const note = this.store.getNote(id);
    if (!note) return null;
    if (archived && this.store.isDocked(id)) this.detachDockedNote(id, { restoreBounds: true });
    const updated = this.store.setArchived(id, archived);
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
    return updated;
  }

  applyPinnedLevel(window, pinned) {
    window.setAlwaysOnTop(Boolean(pinned), "floating");
  }

  remove(id) {
    const window = this.windows.get(id);
    if (!this.store.deleteNote(id)) return;
    this.cancelPendingBounds(id);
    this.resizeSessions.delete(id);
    this.moveSessions.delete(id);
    if (this.shelfNoteDragSession?.id === id) this.shelfNoteDragSession = null;
    this.transitioningNotes.delete(id);
    window?.destroy();
    this.windows.delete(id);
    if (this.activeDockedId === id) this.activeDockedId = null;
    this.reconcileDockSurface();
    this.broadcastNoteList();
    this.sendGroupState();
  }

  toggleNoteDock(id) {
    const note = this.store.getNote(id);
    if (!note || note.archivedAt !== null) return { note: this.store.getRenderableNote(id), group: this.getGroupState() };
    if (this.store.isDocked(id)) this.detachDockedNote(id, { restoreBounds: true });
    else this.dockNote(id);
    return { note: this.store.getRenderableNote(id), group: this.getGroupState() };
  }

  dockNote(id, { animate = false, persist = true } = {}) {
    const note = this.store.getNote(id);
    if (!note || note.archivedAt !== null || this.store.isDocked(id)) return false;
    let window = this.windows.get(id);
    if (!window || window.isDestroyed()) {
      this.store.updateWindow(id, { open: true });
      window = this.open(note);
    }
    if (persist) this.persistBounds(id);
    const mode = this.getDockMode();
    this.store.setDockState(id, mode);
    this.cancelHideGroup();
    if (mode === "shelf") {
      const shelf = this.ensureShelfWindow();
      if (animate && shelf) {
        this.animateNoteIntoShelf(id, window, shelf, !this.shelfExpanded);
      }
      else window.hide();
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
    if (mode === "shelf" && !animate) this.scheduleHideGroup();
    log.info("便签已加入侧边收纳", { id, mode });
    return true;
  }

  detachDockedNote(id, { restoreBounds = true } = {}) {
    const previousMode = this.store.getDockState(id);
    if (previousMode !== "shelf" && previousMode !== "inline") return false;
    const window = this.windows.get(id);
    if (window && !window.isDestroyed()) this.finishNoteTransition(id, window);
    if (this.shelfNoteDragSession?.id === id) this.shelfNoteDragSession = null;
    this.store.setDockState(id, "free");
    if (this.activeDockedId === id) this.activeDockedId = null;
    if (restoreBounds) this.restoreSavedPosition(id, true);
    else if (window && !window.isDestroyed()) {
      window.showInactive();
      window.moveTop();
    }
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
    this.cancelShelfHoverExpansion();
    this.cancelShelfDropExpansion();
    this.shelfExpanded = false;
    this.shelfMoveSession = null;
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
      shelf.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    this.loadRenderer(shelf, {
      view: "shelf",
      edge: this.store.getShelfPlacement(display.id).edge,
    });
    shelf.once("ready-to-show", () => {
      if (this.shelfWindow === shelf && !shelf.isDestroyed() && this.store.listDockedNotes("shelf").length > 0) {
        shelf.showInactive();
        this.armShelfHoverExpansion();
      }
    });
    shelf.on("closed", () => {
      this.shelfMoveSession = null;
      if (this.shelfWindow === shelf) this.shelfWindow = null;
    });
    return shelf;
  }

  setShelfExpanded(expanded) {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return;
    if (!expanded && (this.shelfNoteDragSession || this.moveSessions.size > 0)) return;
    this.cancelHideGroup();
    if (expanded) this.cancelShelfDropExpansion();
    const shelf = this.ensureShelfWindow();
    if (!shelf) return;
    const display = this.findShelfDisplay();
    const target = this.shelfBounds(display, expanded);
    this.shelfExpanded = expanded;
    if (expanded) this.cancelShelfHoverExpansion();
    else this.armShelfHoverExpansion();
    shelf.webContents.send("shelf:expanded", expanded);
    shelf.webContents.send("shelf:placement", this.store.getShelfPlacement(display.id).edge);
    this.animateBounds(shelf, target, SHELF_ANIMATION_MS);
  }

  armShelfHoverExpansion() {
    if (this.shelfExpanded || this.shelfHoverTimer) return;
    this.shelfHoverStartedAt = null;
    const poll = () => {
      this.shelfHoverTimer = null;
      const shelf = this.shelfWindow;
      if (this.shelfExpanded || !shelf || shelf.isDestroyed()) {
        this.shelfHoverStartedAt = null;
        return;
      }
      const hovered = contains(shelf.getBounds(), screen.getCursorScreenPoint());
      if (hovered && !this.shelfMoveSession && !this.shelfNoteDragSession && this.moveSessions.size === 0) {
        this.shelfHoverStartedAt ??= Date.now();
        if (Date.now() - this.shelfHoverStartedAt >= SHELF_HOVER_EXPAND_DELAY_MS) {
          this.setShelfExpanded(true);
          return;
        }
      } else {
        this.shelfHoverStartedAt = null;
      }
      this.shelfHoverTimer = setTimeout(poll, SHELF_HOVER_POLL_MS);
    };
    this.shelfHoverTimer = setTimeout(poll, SHELF_HOVER_POLL_MS);
  }

  cancelShelfHoverExpansion() {
    clearTimeout(this.shelfHoverTimer);
    this.shelfHoverTimer = null;
    this.shelfHoverStartedAt = null;
  }

  scheduleShelfExpansionAfterDrop() {
    this.cancelShelfDropExpansion();
    if (this.shelfExpanded) return;
    this.shelfDropExpandTimer = setTimeout(() => {
      this.shelfDropExpandTimer = null;
      if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return;
      this.setShelfExpanded(true);
      this.scheduleHideGroup();
    }, SHELF_HOVER_EXPAND_DELAY_MS);
  }

  cancelShelfDropExpansion() {
    clearTimeout(this.shelfDropExpandTimer);
    this.shelfDropExpandTimer = null;
  }

  beginShelfMove(sender) {
    const shelf = this.shelfWindow;
    if (
      this.getDockMode() !== "shelf" ||
      !shelf ||
      shelf.isDestroyed() ||
      shelf.webContents !== sender ||
      this.store.listDockedNotes("shelf").length === 0
    ) {
      return false;
    }
    this.cancelHideGroup();
    this.cancelAnimation(shelf);
    const display = screen.getDisplayMatching(shelf.getBounds());
    const startBounds = this.shelfBounds(display, this.shelfExpanded);
    shelf.setBounds(startBounds, false);
    this.shelfMoveSession = {
      senderId: sender.id,
      startDisplayId: display.id,
      displayId: display.id,
      startBounds,
      bounds: startBounds,
    };
    return true;
  }

  beginShelfNoteDrag(id, pointerX, pointerY, sourceBounds, sender) {
    const shelf = this.shelfWindow;
    if (
      this.getDockMode() !== "shelf"
      || !shelf
      || shelf.isDestroyed()
      || shelf.webContents !== sender
      || this.store.getDockState(id) !== "shelf"
      || this.shelfNoteDragSession
    ) return false;

    const note = this.store.getNote(id);
    if (!note) return false;
    let window = this.windows.get(id);
    if (!window || window.isDestroyed()) {
      this.store.updateWindow(id, { open: true });
      window = this.open(note);
    }
    this.cancelHideGroup();
    this.cancelAnimation(window);
    if (this.activeDockedId && this.activeDockedId !== id && this.store.isDocked(this.activeDockedId)) {
      this.windows.get(this.activeDockedId)?.hide();
    }
    this.activeDockedId = id;
    window.setFocusable(false);
    const state = this.store.getWindowState(id);
    const width = state.collapsed ? COLLAPSED_WIDTH : state.bounds.width;
    const height = state.collapsed ? COLLAPSED_HEIGHT : state.bounds.height;
    const offsetX = Math.min(80, Math.round(width / 3));
    const offsetY = Math.min(11, Math.round(height / 2));
    this.shelfNoteDragSession = {
      id,
      senderId: sender.id,
      offsetX,
      offsetY,
      pointerX,
      pointerY,
      revealing: true,
      releasePending: false,
      overShelf: this.shouldDockAtShelf({ x: pointerX, y: pointerY }),
      dropBounds: null,
    };
    this.beginNoteTransition(id, window);
    const start = sourceBounds ?? this.shelfNoteTransitionBounds(shelf);
    window.setBounds(start, false);
    window.showInactive();
    window.moveTop();
    this.animateShelfNoteReveal(window, this.shelfNoteDragSession, start);
    log.info("已从侧边架开始拖动便签", { id });
    return true;
  }

  moveShelfNoteDrag(id, pointerX, pointerY, dropBounds, sender) {
    const session = this.shelfNoteDragSession;
    const window = this.windows.get(id);
    if (
      session?.id !== id
      || session.senderId !== sender.id
      || !window
      || window.isDestroyed()
      || this.store.getDockState(id) !== "shelf"
    ) return false;
    session.pointerX = pointerX;
    session.pointerY = pointerY;
    session.overShelf = this.shouldDockAtShelf({ x: pointerX, y: pointerY }, session.overShelf ? 16 : 0);
    session.dropBounds = session.overShelf ? dropBounds : null;
    if (!session.revealing) window.setBounds(this.shelfNoteDragBounds(session), false);
    return true;
  }

  shelfNoteDragBounds(session) {
    const display = screen.getDisplayNearestPoint({ x: session.pointerX, y: session.pointerY });
    const state = this.store.getWindowState(session.id);
    return this.clampBounds({
      x: Math.round(session.pointerX - session.offsetX),
      y: Math.round(session.pointerY - session.offsetY),
      width: state.collapsed ? COLLAPSED_WIDTH : state.bounds.width,
      height: state.collapsed ? COLLAPSED_HEIGHT : state.bounds.height,
    }, display.workArea);
  }

  animateShelfNoteReveal(window, session, start) {
    const animation = { timer: null };
    const startedAt = performance.now();
    this.animations.set(window.id, animation);
    this.animatingWindows.add(window.id);

    const tick = () => {
      if (window.isDestroyed() || this.animations.get(window.id) !== animation) return;
      const progress = Math.min(1, (performance.now() - startedAt) / SHELF_NOTE_TRANSITION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.setBounds(interpolateBounds(start, this.shelfNoteDragBounds(session), eased), false);
      if (progress < 1) {
        animation.timer = setTimeout(tick, ANIMATION_FRAME_MS);
        return;
      }
      this.animations.delete(window.id);
      this.animatingWindows.delete(window.id);
      session.revealing = false;
      window.setBounds(this.shelfNoteDragBounds(session), false);
      if (session.releasePending) this.finishShelfNoteDrag(true);
    };

    tick();
  }

  endShelfNoteDrag(id, sender) {
    const session = this.shelfNoteDragSession;
    if (session?.id !== id || session.senderId !== sender.id) return false;
    return this.finishShelfNoteDrag(true);
  }

  finishShelfNoteDrag(detach) {
    const session = this.shelfNoteDragSession;
    if (!session) return false;
    if (detach && session.overShelf) {
      this.shelfNoteDragSession = null;
      const window = this.windows.get(session.id);
      const shelf = this.shelfWindow;
      if (!window || window.isDestroyed() || !shelf || shelf.isDestroyed()) return false;
      this.setShelfExpanded(true);
      this.beginNoteTransition(session.id, window);
      const target = this.shelfNoteTransitionBounds(shelf, session.dropBounds);
      this.animateBounds(window, target, SHELF_NOTE_TRANSITION_MS, () => {
        if (!window.isDestroyed()) window.hide();
        if (!window.isDestroyed()) window.setFocusable(true);
        this.finishNoteTransition(session.id, window);
        if (this.activeDockedId === session.id) this.activeDockedId = null;
        this.scheduleHideGroup();
      });
      log.info("侧边架便签已拖回收纳区域", { id: session.id });
      return true;
    }
    if (detach && session.revealing) {
      session.releasePending = true;
      return true;
    }
    this.shelfNoteDragSession = null;
    const window = this.windows.get(session.id);
    if (window && !window.isDestroyed()) this.finishNoteTransition(session.id, window);
    if (!detach) {
      window?.hide();
      if (window && !window.isDestroyed()) window.setFocusable(true);
      return true;
    }
    const detached = this.detachDockedNote(session.id, { restoreBounds: false });
    if (detached) this.persistBounds(session.id);
    log.info("侧边架便签已通过拖动移出", { id: session.id });
    return detached;
  }

  moveShelf(deltaX, deltaY, sender) {
    const shelf = this.shelfWindow;
    const session = this.shelfMoveSession;
    if (
      !Number.isFinite(deltaX) ||
      !Number.isFinite(deltaY) ||
      !shelf ||
      shelf.isDestroyed() ||
      shelf.webContents !== sender ||
      session?.senderId !== sender.id
    ) return false;

    const candidate = {
      x: session.startBounds.x + Math.round(deltaX),
      y: session.startBounds.y + Math.round(deltaY),
      width: session.startBounds.width,
      height: session.startBounds.height,
    };
    const display = screen.getDisplayNearestPoint({
      x: candidate.x + Math.round(candidate.width / 2),
      y: candidate.y + Math.round(candidate.height / 2),
    });
    const area = display.workArea;
    const width = Math.min(candidate.width, area.width);
    const height = Math.min(candidate.height, area.height);
    const target = {
      x: clampValue(candidate.x, area.x, area.x + area.width - width),
      y: clampValue(candidate.y, area.y, area.y + area.height - height),
      width,
      height,
    };
    session.displayId = display.id;
    session.bounds = target;
    shelf.setBounds(target, false);
    if (this.shelfExpanded && this.activeDockedId) {
      this.positionDockedNote(this.activeDockedId, display, target, false);
    }
    shelf.webContents.send("shelf:placement", "free");
    return true;
  }

  endShelfMove(sender) {
    if (this.shelfMoveSession?.senderId !== sender.id) return false;
    return this.finishShelfMove(true);
  }

  finishShelfMove(persist) {
    const session = this.shelfMoveSession;
    this.shelfMoveSession = null;
    const shelf = this.shelfWindow;
    if (!session || !shelf || shelf.isDestroyed()) return false;
    const display = screen.getAllDisplays().find((item) => String(item.id) === String(session.displayId))
      ?? screen.getDisplayMatching(session.bounds);
    const area = display.workArea;
    const leftGap = session.bounds.x - area.x;
    const rightGap = area.x + area.width - session.bounds.x - session.bounds.width;
    const nearestEdgeGap = Math.min(leftGap, rightGap);
    const edge = nearestEdgeGap <= SHELF_EDGE_SNAP_DISTANCE
      ? leftGap <= rightGap ? "left" : "right"
      : "free";
    const placement = {
      x: edge === "left" ? 0 : edge === "right" ? 1 : clampValue(
        (session.bounds.x + session.bounds.width / 2 - area.x) / area.width,
        0,
        1,
      ),
      y: clampValue(
        (session.bounds.y + session.bounds.height / 2 - area.y) / area.height,
        0,
        1,
      ),
      edge,
    };
    this.store.setShelfPlacement(display.id, placement, persist);
    shelf.webContents.send("shelf:placement", edge);
    const target = this.shelfBounds(display, this.shelfExpanded);
    this.animateBounds(shelf, target, SHELF_ANIMATION_MS);
    if (this.shelfExpanded && this.activeDockedId) {
      this.positionDockedNote(this.activeDockedId, display, target, false);
    }
    if (String(session.startDisplayId) !== String(display.id)) {
      log.info("侧边架已移动到显示器", { displayId: display.id });
    }
    log.info("侧边架位置已更新", { displayId: display.id, edge });
    return true;
  }

  revealGroup() {
    this.cancelHideGroup();
    if (this.getDockMode() === "shelf") this.setShelfExpanded(true);
  }

  cancelHideGroup() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  handleBrowserWindowBlur(blurredWindow) {
    if (this.getDockMode() !== "shelf" || this.store.listDockedNotes("shelf").length === 0) return;
    const activeWindow = this.activeDockedId && this.store.getDockState(this.activeDockedId) === "shelf"
      ? this.windows.get(this.activeDockedId)
      : null;
    if (blurredWindow !== activeWindow && blurredWindow !== this.shelfWindow) return;
    this.cancelAppBlurHide();
    this.appBlurTimer = setTimeout(() => {
      this.appBlurTimer = null;
      if (this.shelfNoteDragSession || this.moveSessions.size > 0) return;
      const activeWindowVisible = activeWindow && !activeWindow.isDestroyed() && activeWindow.isVisible();
      if (!this.shelfExpanded && !activeWindowVisible) return;
      this.cancelHideGroup();
      this.hideGroupNow(activeWindow);
      log.info("切换到其他应用后已收回侧边栏");
    }, APP_BLUR_HIDE_DELAY_MS);
  }

  cancelAppBlurHide() {
    clearTimeout(this.appBlurTimer);
    this.appBlurTimer = null;
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
      if (this.shelfNoteDragSession || this.moveSessions.size > 0) {
        this.scheduleHideGroup();
        return;
      }
      this.hideGroupNow(activeWindow);
    }, SHELF_HIDE_DELAY_MS);
  }

  hideGroupNow(activeWindow = null) {
    const window = activeWindow ?? (
      this.activeDockedId && this.store.getDockState(this.activeDockedId) === "shelf"
        ? this.windows.get(this.activeDockedId)
        : null
    );
    if (window && !window.isDestroyed()) window.hide();
    this.activeDockedId = null;
    this.setShelfExpanded(false);
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
    if (this.transitioningNotes.has(id)) this.finishNoteTransition(id, window);
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
    return this.positionDockedNote(id, display, this.shelfBounds(display, true), true);
  }

  closeDockedNote(id) {
    if (this.store.getDockState(id) !== "shelf") return false;
    const window = this.windows.get(id);
    this.cancelPendingBounds(id);
    this.moveSessions.delete(id);
    if (this.shelfNoteDragSession?.id === id) this.finishShelfNoteDrag(false);
    this.store.updateWindow(id, { dockState: "free", open: false });
    if (this.activeDockedId === id) this.activeDockedId = null;
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
    log.info("已关闭侧边栏便签", { id });
    return true;
  }

  positionDockedNote(id, display, shelfTarget, focus) {
    if (this.store.getDockState(id) !== "shelf") return null;
    const window = this.windows.get(id);
    if (!window || window.isDestroyed()) return null;
    const state = this.store.getWindowState(id);
    const height = state.collapsed ? COLLAPSED_HEIGHT : state.bounds.height;
    const leftSpace = shelfTarget.x - display.workArea.x;
    const rightSpace = display.workArea.x + display.workArea.width - shelfTarget.x - shelfTarget.width;
    const noteX = leftSpace >= state.bounds.width + 10 || leftSpace >= rightSpace
      ? shelfTarget.x - state.bounds.width - 10
      : shelfTarget.x + shelfTarget.width + 10;
    const bounds = this.clampBounds({
      x: noteX,
      y: Math.max(display.workArea.y + 12, screen.getCursorScreenPoint().y - 32),
      width: state.bounds.width,
      height,
    }, display.workArea);
    window.setBounds(bounds, false);
    if (focus) {
      window.show();
      window.focus();
    } else if (!window.isVisible()) {
      window.showInactive();
    }
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
      if (note.archivedAt !== null && this.store.getDockState(note.id) !== "free") {
        this.detachDockedNote(note.id, { restoreBounds: true });
      }
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
    if (this.store.isDocked(id) || this.resizeSessions.has(id) || this.transitioningNotes.has(id)) return;
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
    this.store.setShelfPlacement(fallback.id, this.store.getShelfPlacement(fallback.id));
    if (savedId !== null) log.info("侧边架显示器已恢复", { displayId: fallback.id });
    return fallback;
  }

  shelfBounds(display, expanded) {
    const area = display.workArea;
    const width = Math.min(expanded ? SHELF_EXPANDED_WIDTH : SHELF_COLLAPSED_SIZE, area.width);
    const desiredHeight = expanded ? this.shelfExpandedHeight(area) : SHELF_COLLAPSED_SIZE;
    const height = Math.min(desiredHeight, area.height);
    const placement = this.store.getShelfPlacement(display.id);
    const centerX = area.x + placement.x * area.width;
    const centerY = area.y + placement.y * area.height;
    return {
      x: placement.edge === "right"
        ? Math.max(area.x, area.x + area.width - width - (expanded ? SHELF_MARGIN : 0))
        : placement.edge === "left"
          ? Math.min(area.x + area.width - width, area.x + (expanded ? SHELF_MARGIN : 0))
          : clampValue(Math.round(centerX - width / 2), area.x, area.x + area.width - width),
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

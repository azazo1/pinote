import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import log from "electron-log/main.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const COLLAPSED_HEIGHT = 22;
const COLLAPSED_WIDTH = 253;
const SHELF_COLLAPSED_SIZE = 36;
const SHELF_EXPANDED_WIDTH = 200;
const SHELF_MARGIN = 8;
const WINDOW_ANIMATION_MS = 110;
const SHELF_ANIMATION_MS = 90;
const ANIMATION_FRAME_MS = 16;
const SHELF_HIDE_DELAY_MS = 220;

export class WindowManager {
  constructor(store) {
    this.store = store;
    this.windows = new Map();
    this.shelfWindow = null;
    this.shelfExpanded = false;
    this.activeDockedId = null;
    this.hideTimer = null;
    this.animations = new Map();
    this.animatingWindows = new Set();
    this.wayland = isWaylandSession();

    screen.on("display-removed", () => this.constrainAllWindows());
    screen.on("display-metrics-changed", () => this.constrainAllWindows());
  }

  getCapabilities() {
    return { platform: process.platform, wayland: this.wayland };
  }

  open(note) {
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
      resizable: !state.collapsed,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: state.pinned,
      hasShadow: true,
      backgroundColor: "#00000000",
      webPreferences: rendererPreferences(),
    });

    this.windows.set(note.id, window);
    if (process.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    this.loadRenderer(window, { noteId: note.id });

    window.once("ready-to-show", () => {
      if (!this.store.state.groupDocked) window.show();
    });
    window.on("resize", () => this.persistBounds(note.id));
    window.on("move", () => this.persistBounds(note.id));
    window.on("closed", () => {
      this.cancelAnimation(window);
      this.windows.delete(note.id);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      log.error("便签渲染进程退出", { id: note.id, reason: details.reason });
    });
    return window;
  }

  restoreDockedMode() {
    if (!this.store.state.groupDocked) return;
    const mode = this.wayland ? "inline" : "shelf";
    this.store.setGroupDocked(true, mode);
    if (mode === "shelf") {
      for (const window of this.windows.values()) window.hide();
      this.ensureShelfWindow();
    } else {
      const firstId = this.store.state.notes[0]?.id ?? null;
      this.activeDockedId = firstId;
      for (const [id, window] of this.windows) id === firstId ? window.show() : window.hide();
    }
    this.sendGroupState();
  }

  createNearFocused() {
    const focused = BrowserWindow.getFocusedWindow();
    const bounds = focused && focused !== this.shelfWindow ? focused.getBounds() : null;
    const note = this.store.createNote({
      x: bounds ? bounds.x + 28 : undefined,
      y: bounds ? bounds.y + 28 : undefined,
    });
    const window = this.open(note);
    this.broadcastNoteList();
    if (this.store.state.groupDocked) {
      window.once("ready-to-show", () => this.activateDockedNote(note.id));
    }
    return note;
  }

  toggleCollapse(id) {
    const state = this.store.getWindowState(id);
    const window = this.windows.get(id);
    if (!window) return;
    const bounds = window.getBounds();
    const collapsed = !state.collapsed;
    if (collapsed) {
      this.store.updateWindow(id, {
        bounds: { ...bounds, height: Math.max(state.bounds.height, bounds.height) },
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
      this.store.updateWindow(id, { bounds: target, collapsed: false });
      window.setResizable(true);
      this.animateBounds(window, target, WINDOW_ANIMATION_MS, () => {
        window.setMinimumSize(COLLAPSED_WIDTH, 180);
        window.setResizable(true);
      });
    }
    window.webContents.send("note:collapsed", collapsed);
    log.info(collapsed ? "已收起便签" : "已展开便签", { id });
  }

  move(id, x, y) {
    const window = this.windows.get(id);
    if (!window || this.store.state.groupDocked || this.wayland) return;
    window.setPosition(Math.round(x), Math.round(y));
  }

  setPinned(id, pinned) {
    const window = this.windows.get(id);
    if (!window) return;
    window.setAlwaysOnTop(Boolean(pinned), "floating");
    this.store.updateWindow(id, { pinned: Boolean(pinned) });
    log.info(pinned ? "便签已置顶" : "便签已取消置顶", { id });
  }

  remove(id) {
    const window = this.windows.get(id);
    if (!this.store.deleteNote(id)) return;
    window?.destroy();
    if (this.activeDockedId === id) this.activeDockedId = null;
    if (this.store.state.notes.length === 0) this.createNearFocused();
    this.broadcastNoteList();
  }

  toggleGroupDock() {
    const docked = !this.store.state.groupDocked;
    if (docked) this.enterDockedMode();
    else this.leaveDockedMode();
    return { docked, mode: this.store.state.dockMode };
  }

  enterDockedMode() {
    for (const id of this.windows.keys()) this.persistBounds(id, true);
    const mode = this.wayland ? "inline" : "shelf";
    this.store.setGroupDocked(true, mode);
    const focused = BrowserWindow.getFocusedWindow();
    this.activeDockedId = [...this.windows].find(([, window]) => window === focused)?.[0] ?? this.store.state.notes[0]?.id ?? null;

    if (mode === "shelf") {
      for (const window of this.windows.values()) window.hide();
      this.activeDockedId = null;
      this.ensureShelfWindow();
    } else {
      for (const [id, window] of this.windows) id === this.activeDockedId ? window.show() : window.hide();
    }
    this.sendGroupState();
    log.info("便签组已吸附", { mode });
  }

  leaveDockedMode() {
    this.store.setGroupDocked(false, this.wayland ? "inline" : "shelf");
    this.activeDockedId = null;
    if (this.shelfWindow && !this.shelfWindow.isDestroyed()) this.shelfWindow.destroy();
    this.shelfWindow = null;
    this.restoreSavedPositions();
    this.sendGroupState();
    log.info("便签组已离开侧边");
  }

  ensureShelfWindow() {
    if (this.shelfWindow && !this.shelfWindow.isDestroyed()) return this.shelfWindow;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const size = SHELF_COLLAPSED_SIZE;
    const options = {
      x: area.x + area.width - size,
      y: area.y + Math.round((area.height - size) / 2),
      width: size,
      height: size,
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
      shelf.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    this.loadRenderer(shelf, { view: "shelf" });
    shelf.once("ready-to-show", () => shelf.showInactive());
    shelf.on("closed", () => {
      if (this.shelfWindow === shelf) this.shelfWindow = null;
    });
    return shelf;
  }

  setShelfExpanded(expanded) {
    if (!this.store.state.groupDocked || this.store.state.dockMode !== "shelf") return;
    clearTimeout(this.hideTimer);
    const shelf = this.ensureShelfWindow();
    const display = screen.getDisplayMatching(shelf.getBounds());
    const area = display.workArea;
    const width = expanded ? SHELF_EXPANDED_WIDTH : SHELF_COLLAPSED_SIZE;
    const height = expanded ? this.shelfExpandedHeight(area) : SHELF_COLLAPSED_SIZE;
    const target = {
      x: expanded ? area.x + area.width - width - SHELF_MARGIN : area.x + area.width - width,
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };
    this.shelfExpanded = expanded;
    shelf.webContents.send("shelf:expanded", expanded);
    this.animateBounds(shelf, target, SHELF_ANIMATION_MS);
  }

  revealGroup() {
    if (this.store.state.dockMode === "shelf") this.setShelfExpanded(true);
  }

  scheduleHideGroup() {
    if (!this.store.state.groupDocked || this.store.state.dockMode !== "shelf") return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      const cursor = screen.getCursorScreenPoint();
      const visibleWindows = [this.shelfWindow, this.activeDockedId ? this.windows.get(this.activeDockedId) : null].filter(Boolean);
      const hovered = visibleWindows.some((window) => !window.isDestroyed() && contains(window.getBounds(), cursor));
      if (hovered) return;
      if (this.activeDockedId) this.windows.get(this.activeDockedId)?.hide();
      this.activeDockedId = null;
      this.setShelfExpanded(false);
    }, SHELF_HIDE_DELAY_MS);
  }

  activateDockedNote(id) {
    if (!this.store.state.groupDocked || !this.windows.has(id)) return;
    if (this.activeDockedId && this.activeDockedId !== id) this.windows.get(this.activeDockedId)?.hide();
    this.activeDockedId = id;
    const window = this.windows.get(id);
    if (this.store.state.dockMode === "inline") {
      window.show();
      window.focus();
      this.sendGroupState();
      return;
    }

    this.setShelfExpanded(true);
    const shelf = this.ensureShelfWindow();
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
  }

  reconcileRemoteState() {
    const activeIds = new Set(this.store.state.notes.map((note) => note.id));
    for (const [id, window] of this.windows) {
      if (!activeIds.has(id)) window.destroy();
    }
    for (const note of this.store.state.notes) {
      const window = this.windows.get(note.id);
      if (!window || window.isDestroyed()) {
        this.open(note);
        continue;
      }
      const state = this.store.getWindowState(note.id);
      window.setAlwaysOnTop(state.pinned, "floating");
      window.webContents.send("note:remote", this.store.getRenderableNote(note.id));
      if (this.store.state.groupDocked && note.id !== this.activeDockedId) window.hide();
    }
    this.broadcastNoteList();
    this.sendGroupState();
  }

  restoreSavedPositions() {
    for (const [id, window] of this.windows) {
      const state = this.store.getWindowState(id);
      const display = this.findDisplay(state);
      const bounds = this.clampBounds(state.bounds, display.workArea);
      const target = state.collapsed
        ? { ...bounds, x: bounds.x + bounds.width - COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT }
        : bounds;
      window.setMinimumSize(COLLAPSED_WIDTH, state.collapsed ? COLLAPSED_HEIGHT : 180);
      window.setResizable(!state.collapsed);
      window.setAlwaysOnTop(state.pinned, "floating");
      window.show();
      this.animateBounds(window, target);
    }
  }

  constrainAllWindows() {
    if (this.store.state.groupDocked) {
      if (this.store.state.dockMode === "shelf") this.setShelfExpanded(this.shelfExpanded);
      return;
    }
    this.restoreSavedPositions();
  }

  persistBounds(id, force = false) {
    if (this.store.state.groupDocked && !force) return;
    const window = this.windows.get(id);
    if (!window || window.isDestroyed()) return;
    if (this.animatingWindows.has(window.id) && !force) return;
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
    this.broadcast("group:state", {
      docked: this.store.state.groupDocked,
      mode: this.store.state.dockMode,
      activeId: this.activeDockedId,
    });
  }

  broadcastNoteList() {
    this.broadcast("notes:list", this.store.listSummaries());
    if (this.shelfExpanded) this.setShelfExpanded(true);
  }

  shelfExpandedHeight(area) {
    const desired = 42 + this.store.state.notes.length * 32;
    return Math.min(area.height - SHELF_MARGIN * 2, Math.max(110, Math.min(360, desired)));
  }

  broadcast(channel, payload) {
    const targets = [...this.windows.values(), this.shelfWindow];
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

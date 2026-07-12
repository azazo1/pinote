import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import log from "electron-log/main.js";

const CURRENT_VERSION = 4;
const DEFAULT_COLOR = "lemon";
const DEFAULT_SHELF_POSITION = 0.5;

export class NoteStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "notes.json");
    this.tempPath = path.join(userDataPath, "notes.json.tmp");
    this.state = createEmptyState();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = normalizeState(JSON.parse(raw));
      log.info("便签数据已加载", { notes: this.state.notes.length, version: this.state.version });
    } catch (error) {
      if (error?.code !== "ENOENT") log.error("读取便签数据失败", error);
      this.state = createEmptyState();
    }

    await this.save();
    return this.state;
  }

  getNote(id) {
    return this.state.notes.find((note) => note.id === id) ?? null;
  }

  getWindowState(id) {
    return this.state.windows[id] ?? createWindowState();
  }

  getRenderableNote(id) {
    const note = this.getNote(id);
    if (!note) return null;
    const windowState = this.getWindowState(id);
    return {
      ...note,
      collapsed: windowState.collapsed,
      pinned: windowState.pinned,
      open: windowState.open,
    };
  }

  listSummaries() {
    return this.state.notes
      .map((note) => ({
        id: note.id,
        title: note.title,
        markdown: note.markdown,
        color: note.color,
        modifiedAt: note.modifiedAt,
        open: this.getWindowState(note.id).open,
        pinned: this.getWindowState(note.id).pinned,
      }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
  }

  createNote(position = {}) {
    const now = Date.now();
    const note = normalizeContentNote({
      id: randomUUID(),
      title: "新便签",
      markdown: "",
      color: DEFAULT_COLOR,
      revision: 0,
      modifiedAt: now,
      modifiedBy: this.state.deviceId,
      dirty: true,
    }, this.state.deviceId);
    this.state.notes.push(note);
    this.state.windows[note.id] = createWindowState({
      open: true,
      bounds: Number.isFinite(position.x) && Number.isFinite(position.y)
        ? { x: position.x, y: position.y, width: 253, height: 220 }
        : undefined,
    });
    void this.save();
    log.info("已创建便签", { id: note.id });
    return this.getRenderableNote(note.id);
  }

  updateContent(id, patch) {
    const note = this.getNote(id);
    if (!note) return null;
    const next = {
      title: typeof patch.title === "string" ? patch.title.slice(0, 200) : note.title,
      markdown: typeof patch.markdown === "string" ? patch.markdown.slice(0, 2_000_000) : note.markdown,
      color: typeof patch.color === "string" ? patch.color.slice(0, 32) : note.color,
    };
    if (next.title === note.title && next.markdown === note.markdown && next.color === note.color) return this.getRenderableNote(id);
    note.title = next.title;
    note.markdown = next.markdown;
    note.color = next.color;
    note.modifiedAt = Date.now();
    note.modifiedBy = this.state.deviceId;
    note.dirty = true;
    void this.save();
    return this.getRenderableNote(id);
  }

  updateWindow(id, patch) {
    if (!this.getNote(id)) return null;
    const current = this.getWindowState(id);
    this.state.windows[id] = normalizeWindowState({ ...current, ...patch });
    void this.save();
    return this.state.windows[id];
  }

  deleteNote(id) {
    const note = this.getNote(id);
    if (!note) return false;
    this.state.notes = this.state.notes.filter((item) => item.id !== id);
    delete this.state.windows[id];
    this.state.deleted = this.state.deleted.filter((item) => item.id !== id);
    this.state.deleted.push({
      id,
      baseRevision: note.revision,
      deletedAt: Date.now(),
      dirty: true,
    });
    void this.save();
    log.info("已删除便签", { id, baseRevision: note.revision });
    return true;
  }

  setGroupDocked(docked, mode = "shelf") {
    this.state.groupDocked = Boolean(docked);
    this.state.dockMode = mode;
    void this.save();
  }

  getShelfPosition(displayId) {
    const key = normalizeDisplayId(displayId);
    if (key === null) return DEFAULT_SHELF_POSITION;
    return this.state.shelf.positions[key] ?? DEFAULT_SHELF_POSITION;
  }

  setShelfPosition(displayId, normalizedPosition, persist = true) {
    const key = normalizeDisplayId(displayId);
    if (key === null || !Number.isFinite(normalizedPosition)) return null;
    const position = clamp(normalizedPosition, 0, 1, DEFAULT_SHELF_POSITION);
    this.state.shelf.displayId = key;
    this.state.shelf.positions[key] = position;
    if (persist) void this.save();
    return position;
  }

  setSyncSettings(url, encryptedToken) {
    this.state.sync = { url, encryptedToken };
    void this.save();
  }

  buildSyncRequest() {
    return {
      deviceId: this.state.deviceId,
      changes: this.state.notes.filter((note) => note.dirty).map((note) => ({
        id: note.id,
        title: note.title,
        markdown: note.markdown,
        color: note.color,
        baseRevision: note.revision,
        modifiedAt: note.modifiedAt,
        modifiedBy: note.modifiedBy,
      })),
      deletions: this.state.deleted.filter((item) => item.dirty).map(({ id, baseRevision, deletedAt }) => ({ id, baseRevision, deletedAt })),
    };
  }

  applySyncResponse(snapshot) {
    if (!Array.isArray(snapshot?.notes) || !Array.isArray(snapshot?.deleted)) throw new Error("同步响应格式无效");
    const previous = new Map(this.state.notes.map((note) => [note.id, note]));
    const remoteNotes = snapshot.notes.filter(isRemoteNote);
    const remoteDeleted = snapshot.deleted.filter(isRemoteDeletion);
    const deletedIds = new Set(remoteDeleted.map((item) => item.id));
    const activeIds = new Set(remoteNotes.map((item) => item.id));
    const nextNotes = [];

    for (const remote of remoteNotes) {
      const local = previous.get(remote.id);
      nextNotes.push(normalizeContentNote({
        ...remote,
        dirty: false,
      }, this.state.deviceId));
      if (!local && !this.state.windows[remote.id]) this.state.windows[remote.id] = createWindowState({ open: false });
      previous.delete(remote.id);
    }

    for (const [id, local] of previous) {
      if (local.dirty && !deletedIds.has(id)) nextNotes.push(local);
      else delete this.state.windows[id];
    }

    this.state.notes = nextNotes;
    this.state.deleted = this.state.deleted.filter((local) => {
      if (deletedIds.has(local.id)) return false;
      if (activeIds.has(local.id)) return false;
      return local.dirty;
    });
    void this.save();
    return {
      conflicts: Array.isArray(snapshot.conflicts) ? snapshot.conflicts.filter(isRemoteNote).map((note) => note.id) : [],
      notes: this.state.notes.length,
    };
  }

  async save() {
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.tempPath, JSON.stringify(this.state, null, 2), "utf8");
        await rename(this.tempPath, this.filePath);
      })
      .catch((error) => log.error("保存便签数据失败", error));
    return this.writeQueue;
  }

}

function createEmptyState() {
  return {
    version: CURRENT_VERSION,
    deviceId: randomUUID(),
    notes: [],
    windows: {},
    deleted: [],
    groupDocked: false,
    dockMode: "shelf",
    shelf: { displayId: null, positions: {} },
    sync: { url: "", encryptedToken: "" },
  };
}

function normalizeState(value) {
  const empty = createEmptyState();
  const deviceId = typeof value?.deviceId === "string" ? value.deviceId : empty.deviceId;
  const notes = Array.isArray(value?.notes)
    ? value.notes.map((note) => normalizeContentNote({ ...note, markdown: note.markdown ?? note.content }, deviceId))
    : [];
  const windows = {};
  for (const note of notes) {
    const legacy = value?.notes?.find?.((item) => item.id === note.id) ?? {};
    windows[note.id] = normalizeWindowState(value?.windows?.[note.id] ?? {
      bounds: Number.isFinite(legacy.x) && Number.isFinite(legacy.y)
        ? { x: legacy.x, y: legacy.y, width: legacy.width, height: legacy.height }
        : undefined,
      collapsed: legacy.collapsed,
      pinned: legacy.pinned,
    });
  }
  return {
    version: CURRENT_VERSION,
    deviceId,
    notes,
    windows,
    deleted: Array.isArray(value?.deleted) ? value.deleted.filter(isLocalDeletion).map((item) => ({ ...item, dirty: item.dirty !== false })) : [],
    groupDocked: Boolean(value?.groupDocked),
    dockMode: value?.dockMode === "inline" ? "inline" : "shelf",
    shelf: normalizeShelfState(value?.shelf),
    sync: {
      url: typeof value?.sync?.url === "string" ? value.sync.url : "",
      encryptedToken: typeof value?.sync?.encryptedToken === "string" ? value.sync.encryptedToken : "",
    },
  };
}

function normalizeContentNote(note, deviceId) {
  return {
    id: typeof note.id === "string" ? note.id : randomUUID(),
    title: typeof note.title === "string" ? note.title : "新便签",
    markdown: typeof note.markdown === "string" ? note.markdown : "",
    color: typeof note.color === "string" ? note.color : DEFAULT_COLOR,
    revision: Number.isInteger(note.revision) && note.revision >= 0 ? note.revision : 0,
    modifiedAt: Number.isFinite(note.modifiedAt) ? note.modifiedAt : Number.isFinite(note.updatedAt) ? note.updatedAt : Date.now(),
    modifiedBy: typeof note.modifiedBy === "string" ? note.modifiedBy : deviceId,
    dirty: note.dirty !== false,
  };
}

function createWindowState(value = {}) {
  return normalizeWindowState({
    displayId: value.displayId,
    scaleFactor: value.scaleFactor,
    bounds: value.bounds ?? { width: 253, height: 220 },
    collapsed: value.collapsed,
    pinned: value.pinned,
    open: value.open,
    dockState: value.dockState,
  });
}

function normalizeWindowState(value) {
  const bounds = value?.bounds ?? {};
  return {
    displayId: typeof value?.displayId === "string" || Number.isInteger(value?.displayId) ? value.displayId : null,
    scaleFactor: Number.isFinite(value?.scaleFactor) ? value.scaleFactor : 1,
    bounds: {
      x: Number.isFinite(bounds.x) ? bounds.x : undefined,
      y: Number.isFinite(bounds.y) ? bounds.y : undefined,
      width: clamp(bounds.width, 253, 760, 253),
      height: clamp(bounds.height, 180, 900, 220),
    },
    collapsed: Boolean(value?.collapsed),
    pinned: Boolean(value?.pinned),
    open: value?.open !== false,
    dockState: value?.dockState === "active" ? "active" : "free",
  };
}

function normalizeShelfState(value) {
  const positions = Object.fromEntries(
    Object.entries(value?.positions ?? {})
      .filter(([displayId, position]) => normalizeDisplayId(displayId) !== null && Number.isFinite(position))
      .map(([displayId, position]) => [displayId, clamp(position, 0, 1, DEFAULT_SHELF_POSITION)]),
  );
  return {
    displayId: normalizeDisplayId(value?.displayId),
    positions,
  };
}

function normalizeDisplayId(value) {
  if (Number.isInteger(value)) return String(value);
  if (typeof value !== "string" || value.length === 0 || value.length > 32 || !/^-?\d+$/.test(value)) return null;
  return value;
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function isLocalDeletion(value) {
  return Boolean(value && typeof value.id === "string" && Number.isInteger(value.baseRevision) && Number.isFinite(value.deletedAt));
}

function isRemoteDeletion(value) {
  return Boolean(value && typeof value.id === "string" && Number.isInteger(value.revision) && Number.isFinite(value.deletedAt));
}

function isRemoteNote(value) {
  return Boolean(
    value &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.markdown === "string" &&
    typeof value.color === "string" &&
    Number.isInteger(value.revision) &&
    Number.isFinite(value.modifiedAt) &&
    typeof value.modifiedBy === "string",
  );
}

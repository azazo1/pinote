import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NoteStore } from "./note-store.mjs";

function testStorePath() {
  return path.join(tmpdir(), `pinote-store-${randomUUID()}`);
}

function testStore() {
  return new NoteStore(testStorePath());
}

describe("NoteStore", () => {
  it("starts without creating a default note", async () => {
    const store = testStore();
    await store.load();

    expect(store.state.notes).toEqual([]);
    expect(store.listSummaries()).toEqual([]);
    await store.save();
  });

  it("keeps content revision unchanged when window bounds change", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    const before = { revision: note.revision, modifiedAt: note.modifiedAt, dirty: note.dirty };

    store.updateWindow(note.id, {
      displayId: 2,
      scaleFactor: 1.5,
      bounds: { x: 40, y: 60, width: 500, height: 560 },
    });

    expect(store.getNote(note.id)).toMatchObject(before);
    expect(store.getWindowState(note.id).bounds).toMatchObject({ x: 40, y: 60, width: 500, height: 560 });
    await store.save();
  });

  it("keeps window visibility local without changing content", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    const before = { revision: note.revision, modifiedAt: note.modifiedAt, dirty: note.dirty };

    store.updateWindow(note.id, { open: false });

    expect(store.getNote(note.id)).toMatchObject(before);
    expect(store.getWindowState(note.id).open).toBe(false);
    expect(store.listSummaries()).toEqual([
      expect.objectContaining({ id: note.id, open: false }),
    ]);
    expect(store.buildSyncRequest().changes[0]).not.toHaveProperty("open");
    await store.save();
  });

  it("tracks dock membership independently for each note", async () => {
    const dataPath = testStorePath();
    const store = new NoteStore(dataPath);
    await store.load();
    const released = store.createNote();
    const docked = store.createNote();
    const before = { revision: released.revision, modifiedAt: released.modifiedAt, dirty: released.dirty };

    store.setDockState(released.id, "shelf");
    store.setDockState(docked.id, "shelf");
    store.setDockState(released.id, "free");

    expect(store.getNote(released.id)).toMatchObject(before);
    expect(store.getDockState(released.id)).toBe("free");
    expect(store.getDockState(docked.id)).toBe("shelf");
    expect(store.isDocked(released.id)).toBe(false);
    expect(store.isDocked(docked.id)).toBe(true);
    expect(store.listDockedNotes()).toEqual([
      expect.objectContaining({ id: docked.id, dockState: "shelf" }),
    ]);
    expect(store.listSummaries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: released.id, dockState: "free" }),
      expect.objectContaining({ id: docked.id, dockState: "shelf" }),
    ]));
    expect(store.buildSyncRequest().changes[0]).not.toHaveProperty("dockState");
    await store.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.getDockState(released.id)).toBe("free");
    expect(restored.getDockState(docked.id)).toBe("shelf");
  });

  it("validates dock state changes and supports mode filtering", async () => {
    const store = testStore();
    await store.load();
    const shelf = store.createNote();
    const inline = store.createNote();

    store.setDockState(shelf.id, "shelf");
    store.setDockState(inline.id, "inline");

    expect(store.setDockState(shelf.id, "active")).toBeNull();
    expect(store.getDockState(shelf.id)).toBe("shelf");
    expect(store.listDockedNotes("shelf").map((note) => note.id)).toEqual([shelf.id]);
    expect(store.listDockedNotes("inline").map((note) => note.id)).toEqual([inline.id]);
    expect(store.listDockedNotes("active")).toEqual([]);
    await store.save();
  });

  it("migrates version 4 group docking into per-note state", async () => {
    const dataPath = testStorePath();
    const legacy = new NoteStore(dataPath);
    await legacy.load();
    const first = legacy.createNote();
    const second = legacy.createNote();
    legacy.state.version = 4;
    legacy.state.groupDocked = true;
    legacy.state.dockMode = "inline";
    await legacy.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.state.version).toBe(8);
    expect(restored.state).not.toHaveProperty("groupDocked");
    expect(restored.state).not.toHaveProperty("dockMode");
    expect(restored.getDockState(first.id)).toBe("inline");
    expect(restored.getDockState(second.id)).toBe("inline");
    expect(restored.listDockedNotes("inline").map((note) => note.id)).toEqual([first.id, second.id]);
  });

  it("persists a closed note without deleting its content", async () => {
    const dataPath = testStorePath();
    const first = new NoteStore(dataPath);
    await first.load();
    const note = first.createNote();
    first.updateContent(note.id, { title: "保留的便签", markdown: "不会随窗口关闭而删除" });
    first.updateWindow(note.id, { open: false });
    await first.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.getNote(note.id)).toMatchObject({ title: "保留的便签", markdown: "不会随窗口关闭而删除" });
    expect(restored.getWindowState(note.id).open).toBe(false);
    expect(restored.state.deleted).toEqual([]);
  });

  it("persists a clamped shelf placement for each display", async () => {
    const dataPath = testStorePath();
    const first = new NoteStore(dataPath);
    await first.load();
    const note = first.createNote();
    const before = { revision: note.revision, modifiedAt: note.modifiedAt, dirty: note.dirty };

    first.setShelfPlacement(101, { x: -0.4, y: 1.4, edge: "free" });
    first.setShelfPlacement(202, { x: 0.24, y: 0.76, edge: "free" });
    await first.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.getShelfPlacement(101)).toEqual({ x: 0, y: 1, edge: "free" });
    expect(restored.getShelfPlacement(202)).toEqual({ x: 0.24, y: 0.76, edge: "free" });
    expect(restored.state.shelf.displayId).toBe("202");
    expect(restored.getNote(note.id)).toMatchObject(before);
  });

  it("migrates a version 6 shelf position to the right edge", async () => {
    const dataPath = testStorePath();
    const legacy = new NoteStore(dataPath);
    await legacy.load();
    legacy.state.version = 6;
    legacy.state.shelf = { displayId: "101", positions: { 101: 0.32 } };
    await legacy.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.state.version).toBe(8);
    expect(restored.getShelfPlacement(101)).toEqual({ x: 1, y: 0.32, edge: "right" });
    expect(restored.state.shelf).not.toHaveProperty("positions");
  });

  it("acknowledges an accepted content revision", async () => {
    const store = testStore();
    await store.load();
    const local = store.createNote();
    const request = store.buildSyncRequest();

    store.applySyncResponse({
      notes: [{ ...local, revision: 1, dirty: undefined }],
      deleted: [],
      conflicts: [],
    }, request);

    expect(store.getNote(local.id)).toMatchObject({ revision: 1, dirty: false });
    await store.save();
  });

  it("restores a server note when a stale deletion is rejected", async () => {
    const store = testStore();
    await store.load();
    const local = store.createNote();
    store.deleteNote(local.id);
    const request = store.buildSyncRequest();

    store.applySyncResponse({
      notes: [{ ...local, revision: 2, dirty: undefined }],
      deleted: [],
      conflicts: [],
    }, request);

    expect(store.getNote(local.id)).toMatchObject({ revision: 2, dirty: false });
    expect(store.getWindowState(local.id).open).toBe(false);
    expect(store.state.deleted).toEqual([]);
    await store.save();
  });

  it("keeps an edit made while its previous version is syncing", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    store.updateContent(note.id, { title: "发送版本", markdown: "第一版" });
    const request = store.buildSyncRequest();
    store.updateContent(note.id, { title: "本地新版本", markdown: "第二版" });

    const sent = request.changes[0];
    const result = store.applySyncResponse({
      notes: [{ ...sent, revision: 1 }],
      deleted: [],
      conflicts: [],
    }, request);

    expect(store.getNote(note.id)).toMatchObject({
      title: "本地新版本",
      markdown: "第二版",
      revision: 1,
      dirty: true,
    });
    expect(store.buildSyncRequest().changes[0].baseRevision).toBe(1);
    expect(result.pending).toBe(true);
    await store.save();
  });

  it("keeps the renderer edit base when a remote revision arrives first", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    const createRequest = store.buildSyncRequest();
    store.applySyncResponse({
      notes: [{ ...createRequest.changes[0], revision: 1 }],
      deleted: [],
      conflicts: [],
    }, createRequest);
    const current = store.getNote(note.id);
    const remote = {
      ...current,
      markdown: "远端版本",
      revision: 2,
      modifiedAt: current.modifiedAt + 1,
      modifiedBy: "remote-device",
      dirty: undefined,
    };
    store.applySyncResponse({ notes: [remote], deleted: [], conflicts: [] }, store.buildSyncRequest());

    store.updateContent(note.id, { markdown: "本地待保存版本" }, 1);

    expect(store.getNote(note.id)).toMatchObject({
      markdown: "本地待保存版本",
      revision: 1,
      dirty: true,
    });
    expect(store.buildSyncRequest().changes[0].baseRevision).toBe(1);
    await store.save();
  });

  it("keeps and rebases a deletion made while content is syncing", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    store.updateContent(note.id, { markdown: "即将删除" });
    const contentRequest = store.buildSyncRequest();
    store.deleteNote(note.id);

    const sent = contentRequest.changes[0];
    const firstResult = store.applySyncResponse({
      notes: [{ ...sent, revision: 1 }],
      deleted: [],
      conflicts: [],
    }, contentRequest);

    expect(store.getNote(note.id)).toBeNull();
    expect(store.state.deleted).toEqual([
      expect.objectContaining({ id: note.id, baseRevision: 1, dirty: true }),
    ]);
    expect(firstResult.pending).toBe(true);

    const deletionRequest = store.buildSyncRequest();
    const secondResult = store.applySyncResponse({
      notes: [],
      deleted: [{ id: note.id, revision: 2, deletedAt: Date.now() }],
      conflicts: [],
    }, deletionRequest);

    expect(store.getNote(note.id)).toBeNull();
    expect(store.state.deleted).toEqual([]);
    expect(secondResult.pending).toBe(false);
    await store.save();
  });

  it("acknowledges a deletion created after the request when the server already has a tombstone", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    const request = store.buildSyncRequest();
    store.deleteNote(note.id);

    const result = store.applySyncResponse({
      notes: [],
      deleted: [{ id: note.id, revision: 1, deletedAt: Date.now() }],
      conflicts: [],
    }, request);

    expect(store.getNote(note.id)).toBeNull();
    expect(store.state.deleted).toEqual([]);
    expect(result.pending).toBe(false);
    await store.save();
  });

  it("acknowledges a sent deletion when the server already has no note", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    store.deleteNote(note.id);
    const request = store.buildSyncRequest();

    const result = store.applySyncResponse({ notes: [], deleted: [], conflicts: [] }, request);

    expect(store.getNote(note.id)).toBeNull();
    expect(store.state.deleted).toEqual([]);
    expect(result.pending).toBe(false);
    await store.save();
  });

  it("keeps a newly synchronized note closed on this device", async () => {
    const store = testStore();
    await store.load();
    const remote = {
      id: randomUUID(),
      title: "远端便签",
      markdown: "内容",
      color: "lemon",
      groupName: "工作",
      tags: ["同步"],
      revision: 1,
      modifiedAt: Date.now(),
      modifiedBy: "remote-device",
    };
    const invalidMetadata = { ...remote, id: randomUUID(), groupName: undefined };

    store.applySyncResponse({ notes: [remote, invalidMetadata], deleted: [], conflicts: [] });

    expect(store.getNote(remote.id)).toMatchObject({
      id: remote.id,
      groupName: "工作",
      tags: ["同步"],
      dirty: false,
    });
    expect(store.getNote(invalidMetadata.id)).toBeNull();
    expect(store.getWindowState(remote.id).open).toBe(false);
    await store.save();
  });

  it("normalizes group and tags as synchronized content", async () => {
    const store = testStore();
    await store.load();
    const note = store.createNote();
    expect(note).toMatchObject({ groupName: "", tags: [] });
    const letter = String.fromCodePoint(0x10330);
    const longTag = `${"x".repeat(39)}${letter}tail`;
    const tags = [" Work ", "work", "", "  ", longTag, ...Array.from({ length: 20 }, (_, index) => `tag-${index}`)];
    store.getNote(note.id).dirty = false;
    store.getNote(note.id).modifiedAt = 1;

    const updated = store.updateContent(note.id, {
      title: `${"t".repeat(199)}${letter}tail`,
      groupName: `  ${"g".repeat(79)}${letter}tail  `,
      tags,
    });

    expect(updated.title).toBe(`${"t".repeat(199)}${letter}`);
    expect(updated.groupName).toBe(`${"g".repeat(79)}${letter}`);
    expect(updated.tags).toHaveLength(16);
    expect(updated.tags.slice(0, 3)).toEqual(["Work", `${"x".repeat(39)}${letter}`, "tag-0"]);
    expect(store.getNote(note.id)).toMatchObject({ dirty: true, modifiedBy: store.state.deviceId });
    expect(store.getNote(note.id).modifiedAt).toBeGreaterThan(1);
    expect(store.listSummaries()[0]).toMatchObject({ groupName: updated.groupName, tags: updated.tags });
    expect(store.buildSyncRequest().changes[0]).toMatchObject({ groupName: updated.groupName, tags: updated.tags });
    await store.save();
  });

  it("loads legacy notes with empty group and tags", async () => {
    const dataPath = testStorePath();
    const legacy = new NoteStore(dataPath);
    await legacy.load();
    const note = legacy.createNote();
    legacy.state.version = 5;
    delete legacy.getNote(note.id).groupName;
    delete legacy.getNote(note.id).tags;
    await legacy.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.state.version).toBe(8);
    expect(restored.getNote(note.id)).toMatchObject({ groupName: "", tags: [] });
  });

  it("migrates version 7 data with default preferences", async () => {
    const dataPath = testStorePath();
    const legacy = new NoteStore(dataPath, "linux");
    await legacy.load();
    legacy.state.version = 7;
    delete legacy.state.preferences;
    await legacy.save();

    const restored = new NoteStore(dataPath, "linux");
    await restored.load();

    expect(restored.state.version).toBe(8);
    expect(restored.getPreferences()).toMatchObject({
      showMainOnLogin: true,
      closeMainToTray: true,
      hideDockOnMainClose: false,
      defaultNoteColor: "lemon",
      defaultNotePinned: false,
    });
    expect(restored.getPreferences().shortcuts["new-note"]).toEqual({
      accelerator: "Control+Shift+N",
      global: false,
    });
  });

  it("uses normalized preferences for every new note", async () => {
    const store = testStore();
    await store.load();
    store.updatePreferences({ defaultNoteColor: "mint", defaultNotePinned: true });

    const note = store.createNote();

    expect(note).toMatchObject({ color: "mint", pinned: true });
    store.updatePreferences({ defaultNoteColor: "purple" });
    expect(store.getPreferences().defaultNoteColor).toBe("lemon");
  });

  it("persists the Dock visibility preference", async () => {
    const dataPath = testStorePath();
    const store = new NoteStore(dataPath, "darwin");
    await store.load();
    store.updatePreferences({ hideDockOnMainClose: true });
    await store.save();

    const restored = new NoteStore(dataPath, "darwin");
    await restored.load();

    expect(restored.getPreferences().hideDockOnMainClose).toBe(true);
  });
});

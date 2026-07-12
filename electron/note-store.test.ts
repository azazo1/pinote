import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NoteStore } from "./note-store.mjs";

function testStore() {
  return new NoteStore(`/private/tmp/pinote-store-${randomUUID()}`);
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
    const dataPath = `/private/tmp/pinote-store-${randomUUID()}`;
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
    const dataPath = `/private/tmp/pinote-store-${randomUUID()}`;
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

    expect(restored.state.version).toBe(5);
    expect(restored.state).not.toHaveProperty("groupDocked");
    expect(restored.state).not.toHaveProperty("dockMode");
    expect(restored.getDockState(first.id)).toBe("inline");
    expect(restored.getDockState(second.id)).toBe("inline");
    expect(restored.listDockedNotes("inline").map((note) => note.id)).toEqual([first.id, second.id]);
  });

  it("persists a closed note without deleting its content", async () => {
    const dataPath = `/private/tmp/pinote-store-${randomUUID()}`;
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

  it("persists a clamped shelf position for each display", async () => {
    const dataPath = `/private/tmp/pinote-store-${randomUUID()}`;
    const first = new NoteStore(dataPath);
    await first.load();
    const note = first.createNote();
    const before = { revision: note.revision, modifiedAt: note.modifiedAt, dirty: note.dirty };

    first.setShelfPosition(101, -0.4);
    first.setShelfPosition(202, 0.76);
    await first.save();

    const restored = new NoteStore(dataPath);
    await restored.load();

    expect(restored.getShelfPosition(101)).toBe(0);
    expect(restored.getShelfPosition(202)).toBe(0.76);
    expect(restored.state.shelf.displayId).toBe("202");
    expect(restored.getNote(note.id)).toMatchObject(before);
  });

  it("acknowledges an accepted content revision", async () => {
    const store = testStore();
    await store.load();
    const local = store.createNote();

    store.applySyncResponse({
      notes: [{ ...local, revision: 1, dirty: undefined }],
      deleted: [],
      conflicts: [],
    });

    expect(store.getNote(local.id)).toMatchObject({ revision: 1, dirty: false });
    await store.save();
  });

  it("restores a server note when a stale deletion is rejected", async () => {
    const store = testStore();
    await store.load();
    const local = store.createNote();
    store.deleteNote(local.id);

    store.applySyncResponse({
      notes: [{ ...local, revision: 2, dirty: undefined }],
      deleted: [],
      conflicts: [],
    });

    expect(store.getNote(local.id)).toMatchObject({ revision: 2, dirty: false });
    expect(store.getWindowState(local.id).open).toBe(false);
    expect(store.state.deleted).toEqual([]);
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
      revision: 1,
      modifiedAt: Date.now(),
      modifiedBy: "remote-device",
    };

    store.applySyncResponse({ notes: [remote], deleted: [], conflicts: [] });

    expect(store.getNote(remote.id)).toMatchObject({ id: remote.id, dirty: false });
    expect(store.getWindowState(remote.id).open).toBe(false);
    await store.save();
  });
});

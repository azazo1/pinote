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

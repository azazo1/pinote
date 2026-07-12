import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NoteStore } from "./note-store.mjs";

function testStore() {
  return new NoteStore(`/private/tmp/pinote-store-${randomUUID()}`);
}

describe("NoteStore", () => {
  it("keeps content revision unchanged when window bounds change", async () => {
    const store = testStore();
    await store.load();
    const note = store.state.notes[0];
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

  it("acknowledges an accepted content revision", async () => {
    const store = testStore();
    await store.load();
    const local = store.state.notes[0];

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
    const local = store.state.notes[0];
    store.deleteNote(local.id);

    store.applySyncResponse({
      notes: [{ ...local, revision: 2, dirty: undefined }],
      deleted: [],
      conflicts: [],
    });

    expect(store.getNote(local.id)).toMatchObject({ revision: 2, dirty: false });
    expect(store.state.deleted).toEqual([]);
    await store.save();
  });
});

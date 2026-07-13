// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Note, NoteAPI } from "./types";

vi.mock("./components/NoteEditor", () => ({
  NoteEditor: () => <div role="textbox" aria-label="便签内容" />,
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/?noteId=note-1");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App archive state", () => {
  it("does not render an archive checkbox for an active note", async () => {
    installNoteApi(activeNote());

    const view = render(<App />);

    await view.findByDisplayValue("测试便签");
    expect(view.queryByRole("checkbox", { name: "恢复为活跃便签" })).toBeNull();
  });

  it("restores an archived note from its checked checkbox", async () => {
    const archived = { ...activeNote(), archivedAt: 1_000 };
    const api = installNoteApi(archived);
    api.setNoteArchived.mockResolvedValue(activeNote());
    const view = render(<App />);
    const checkbox = await view.findByRole("checkbox", { name: "恢复为活跃便签" });

    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);

    await waitFor(() => expect(api.setNoteArchived).toHaveBeenCalledWith("note-1", false));
    await waitFor(() => expect(view.queryByRole("checkbox", { name: "恢复为活跃便签" })).toBeNull());
  });
});

function activeNote(): Note {
  return {
    id: "note-1",
    title: "测试便签",
    markdown: "",
    color: "lemon",
    groupName: "",
    tags: [],
    archivedAt: null,
    revision: 1,
    modifiedAt: 1_000,
    modifiedBy: "device-a",
    dirty: false,
    collapsed: false,
    pinned: false,
    open: true,
    dockState: "free",
  };
}

function installNoteApi(note: Note) {
  const noSubscription = () => vi.fn();
  const api = {
    getNote: vi.fn().mockResolvedValue({
      note,
      group: { mode: "shelf", activeId: null, dockedIds: [] },
      capabilities: { platform: "darwin", wayland: false },
    }),
    getSyncStatus: vi.fn().mockResolvedValue({ state: "idle", message: "同步未启用" }),
    setNoteArchived: vi.fn().mockResolvedValue(note),
    updateNote: vi.fn(),
    onCollapsed: noSubscription,
    onGroupState: noSubscription,
    onCommand: noSubscription,
    onRemoteNote: noSubscription,
    onFlushRequested: noSubscription,
    onSyncStatus: noSubscription,
  } as unknown as NoteAPI & { setNoteArchived: ReturnType<typeof vi.fn> };
  Object.defineProperty(window, "noteAPI", { configurable: true, value: api });
  return api;
}

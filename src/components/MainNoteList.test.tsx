// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteSummary } from "../types";
import { MainNoteList } from "./MainNoteList";

afterEach(cleanup);

describe("MainNoteList archive actions", () => {
  it("marks an active note as archived", () => {
    const onSetArchived = vi.fn();
    const view = renderList(activeNote(), onSetArchived);

    fireEvent.click(view.getByRole("button", { name: "标记完成" }));

    expect(onSetArchived).toHaveBeenCalledWith("note-1", true);
  });

  it("restores an archived note", () => {
    const onSetArchived = vi.fn();
    const view = renderList({ ...activeNote(), archivedAt: 1_000 }, onSetArchived);

    fireEvent.click(view.getByRole("button", { name: "恢复为活跃便签" }));

    expect(onSetArchived).toHaveBeenCalledWith("note-1", false);
  });
});

function renderList(note: NoteSummary, onSetArchived: (id: string, archived: boolean) => void) {
  return render(
    <MainNoteList
      notes={[note]}
      deletingId={null}
      updatingId={null}
      onOpen={vi.fn()}
      onSetArchived={onSetArchived}
      onDelete={vi.fn()}
    />,
  );
}

function activeNote(): NoteSummary {
  return {
    id: "note-1",
    title: "测试便签",
    markdown: "",
    color: "lemon",
    groupName: "",
    tags: [],
    archivedAt: null,
    modifiedAt: 1_000,
    open: false,
    pinned: false,
    dockState: "free",
  };
}

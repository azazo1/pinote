// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShelfApp from "./ShelfApp";
import type { GroupState, NoteAPI, NoteSummary } from "./types";

const flushWorkspace = vi.fn().mockResolvedValue(undefined);
const focusWorkspaceEditor = vi.fn();

vi.mock("./App", () => ({
  NoteWorkspace: forwardRef(function MockNoteWorkspace(
    { noteId, initialFocus }: { noteId: string; initialFocus?: string | null },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ flush: flushWorkspace, focusEditor: focusWorkspaceEditor, focusTitle: vi.fn() }));
    return <div data-testid="shelf-note-workspace">{`${noteId}:${initialFocus ?? "editor"}`}</div>;
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?view=shelf&edge=right");
  installNoteApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  flushWorkspace.mockClear();
  focusWorkspaceEditor.mockClear();
});

describe("ShelfApp repeat click guard", () => {
  it("持续点击时续期并在点击停止后移除", () => {
    const view = render(<ShelfApp />);

    fireEvent.click(view.getByRole("button", { name: "展开侧边便签架" }));
    const guard = view.container.querySelector<HTMLElement>(".shelf-repeat-click-guard");
    expect(guard).not.toBeNull();

    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerDown(guard!);
    act(() => vi.advanceTimersByTime(400));
    expect(view.container.querySelector(".shelf-repeat-click-guard")).not.toBeNull();

    act(() => vi.advanceTimersByTime(101));
    expect(view.container.querySelector(".shelf-repeat-click-guard")).toBeNull();
  });
});

describe("ShelfApp workspace", () => {
  it("在同一侧边窗口中选择并切换便签", async () => {
    const installed = installNoteApi([
      noteSummary("note-1", "第一张"),
      noteSummary("note-2", "第二张"),
    ]);
    const view = render(<ShelfApp />);
    await act(async () => {});
    expect(view.getByText("第一张")).toBeTruthy();

    act(() => installed.emitGroup({ mode: "shelf", activeId: "note-1", dockedIds: ["note-1", "note-2"] }));
    expect(view.getByTestId("shelf-note-workspace").textContent).toBe("note-1:editor");
    expect(focusWorkspaceEditor).not.toHaveBeenCalled();
    act(() => installed.emitExpanded(true));
    act(() => vi.runOnlyPendingTimers());
    expect(focusWorkspaceEditor).toHaveBeenCalledOnce();

    await act(async () => fireEvent.click(view.getByText("第二张").closest("button")!));
    expect(flushWorkspace).toHaveBeenCalledOnce();
    expect(installed.api.activateDockedNote).toHaveBeenCalledWith("note-2");
    act(() => installed.emitGroup({ mode: "shelf", activeId: "note-2", dockedIds: ["note-1", "note-2"] }));
    expect(view.getByTestId("shelf-note-workspace").textContent).toBe("note-2:editor");
  });

  it("侧边新建便签使用标题作为初始焦点", async () => {
    const installed = installNoteApi();
    const view = render(<ShelfApp />);
    await act(async () => fireEvent.click(view.getByRole("button", { name: "新建便签" })));
    act(() => installed.emitGroup({ mode: "shelf", activeId: "note-3", dockedIds: ["note-3"] }));
    expect(view.getByTestId("shelf-note-workspace").textContent).toBe("note-3:title");
  });
});

function installNoteApi(notes: NoteSummary[] = []) {
  const noSubscription = () => vi.fn();
  let groupListener: (state: GroupState) => void = () => {};
  let expandedListener: (expanded: boolean) => void = () => {};
  const api = {
    listNotes: vi.fn().mockResolvedValue(notes),
    createDockedNote: vi.fn().mockResolvedValue({ id: "note-3" }),
    setShelfExpanded: vi.fn().mockResolvedValue(undefined),
    cancelGroupHide: vi.fn(),
    hideGroup: vi.fn(),
    activateDockedNote: vi.fn().mockResolvedValue(undefined),
    onNoteList: noSubscription,
    onShelfExpanded: vi.fn((listener) => {
      expandedListener = listener;
      return vi.fn();
    }),
    onShelfPlacement: noSubscription,
    onGroupState: vi.fn((listener) => {
      groupListener = listener;
      return vi.fn();
    }),
    onShelfWorkspace: noSubscription,
  } as unknown as NoteAPI;
  Object.defineProperty(window, "noteAPI", { configurable: true, value: api });
  return {
    api: api as NoteAPI & { activateDockedNote: ReturnType<typeof vi.fn> },
    emitGroup: (state: GroupState) => groupListener(state),
    emitExpanded: (expanded: boolean) => expandedListener(expanded),
  };
}

function noteSummary(id: string, title: string): NoteSummary {
  return {
    id,
    title,
    markdown: "",
    color: "lemon",
    groupName: "",
    tags: [],
    archivedAt: null,
    modifiedAt: 1_000,
    open: true,
    pinned: false,
    dockState: "shelf" as const,
  };
}

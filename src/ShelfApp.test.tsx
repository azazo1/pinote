// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShelfApp from "./ShelfApp";
import type { NoteAPI } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?view=shelf&edge=right");
  installNoteApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

function installNoteApi() {
  const noSubscription = () => vi.fn();
  const api = {
    listNotes: vi.fn().mockResolvedValue([]),
    setShelfExpanded: vi.fn(),
    cancelGroupHide: vi.fn(),
    hideGroup: vi.fn(),
    onNoteList: noSubscription,
    onShelfExpanded: noSubscription,
    onShelfPlacement: noSubscription,
  } as unknown as NoteAPI;
  Object.defineProperty(window, "noteAPI", { configurable: true, value: api });
}

// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteList } from "./NoteList";
import type { NoteSummary } from "../types";

const notes: NoteSummary[] = [
  createNote("first", "第一张"),
  createNote("second", "第二张"),
];

afterEach(cleanup);

describe("NoteList", () => {
  it("普通指针点击只选择一次", () => {
    const onSelect = vi.fn();
    const view = render(<NoteList notes={notes} onSelect={onSelect} onDragStart={vi.fn()} />);
    const list = view.getByRole("list");
    const first = noteButton(view.container, "first");

    fireEvent.pointerDown(first, pointerEvent({ pointerId: 1, screenX: 20, screenY: 20 }));
    fireEvent.pointerUp(list, pointerEvent({ pointerId: 1, screenX: 20, screenY: 20, buttons: 0 }));
    fireEvent.click(first);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("first");
  });

  it("连续拖动不会丢失第二次手势", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const view = render(
      <NoteList notes={notes} onSelect={vi.fn()} onDragStart={onDragStart} onDragEnd={onDragEnd} />,
    );
    const list = view.getByRole("list");
    const first = noteButton(view.container, "first");
    stubPointerCapture(list);

    drag(first, list, 2);
    drag(first, list, 3);

    expect(onDragStart).toHaveBeenCalledTimes(2);
    expect(onDragEnd).toHaveBeenCalledTimes(2);
  });

  it("使用占位条推动其他便签条让位", () => {
    const view = render(
      <NoteList
        notes={notes}
        draggingId="first"
        dragReturnIndex={0}
        onSelect={vi.fn()}
        onDragStart={vi.fn()}
      />,
    );

    expect(noteRow(view.container, "first").classList.contains("is-drag-source")).toBe(true);
    expect(view.container.querySelector(".note-list-drop-slot")).not.toBeNull();
    expect(noteRow(view.container, "second").style.transform).toBe("translateY(32px)");
  });
});

function drag(source: HTMLElement, list: HTMLElement, pointerId: number) {
  fireEvent.pointerDown(source, pointerEvent({ pointerId, screenX: 20, screenY: 20 }));
  fireEvent.pointerMove(list, pointerEvent({ pointerId, screenX: 40, screenY: 40 }));
  fireEvent.pointerUp(list, pointerEvent({ pointerId, screenX: 40, screenY: 40, buttons: 0 }));
}

function pointerEvent(input: { pointerId: number; screenX: number; screenY: number; buttons?: number }) {
  return {
    bubbles: true,
    button: 0,
    buttons: input.buttons ?? 1,
    isPrimary: true,
    pointerId: input.pointerId,
    screenX: input.screenX,
    screenY: input.screenY,
  };
}

function stubPointerCapture(element: HTMLElement) {
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => false);
  element.releasePointerCapture = vi.fn();
}

function noteRow(container: HTMLElement, id: string) {
  const row = container.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!row) throw new Error(`缺少便签条 ${id}`);
  return row;
}

function noteButton(container: HTMLElement, id: string) {
  const button = noteRow(container, id).querySelector<HTMLElement>(".note-list-item");
  if (!button) throw new Error(`缺少便签按钮 ${id}`);
  return button;
}

function createNote(id: string, title: string): NoteSummary {
  return {
    id,
    title,
    markdown: "",
    color: "lemon",
    groupName: "",
    tags: [],
    archivedAt: null,
    modifiedAt: 0,
    open: true,
    pinned: false,
    dockState: "shelf",
  };
}

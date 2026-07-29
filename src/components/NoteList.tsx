import { X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { NoteSummary, WindowBounds } from "../types";
import { noteColors } from "./ColorPicker";

const NOTE_DRAG_THRESHOLD = 8;
const CLOSE_CONFIRMATION_IDLE_MS = 2_000;

interface NoteListProps {
  notes: NoteSummary[];
  activeId?: string | null;
  draggingId?: string | null;
  dragReturnIndex?: number | null;
  closeConfirmationResetKey?: boolean;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onDragStart?: (id: string, screenX: number, screenY: number, sourceBounds: WindowBounds) => void;
  onDragMove?: (id: string, screenX: number, screenY: number) => void;
  onDragEnd?: (id: string) => void;
}

interface NoteListDrag {
  id: string;
  pointerId: number;
  screenX: number;
  screenY: number;
  sourceBounds: WindowBounds;
  started: boolean;
}

export function NoteList({
  notes,
  activeId,
  draggingId,
  dragReturnIndex,
  closeConfirmationResetKey,
  onSelect,
  onClose,
  onDragStart,
  onDragMove,
  onDragEnd,
}: NoteListProps) {
  const drag = useRef<NoteListDrag | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const handledPointerClickId = useRef<string | null>(null);
  const suppressClickId = useRef<string | null>(null);
  const [closeConfirmationId, setCloseConfirmationId] = useState<string | null>(null);

  function requestClose(id: string) {
    if (closeConfirmationId !== id) {
      setCloseConfirmationId(id);
      return;
    }
    setCloseConfirmationId(null);
    onClose?.(id);
  }

  useEffect(() => {
    if (closeConfirmationId === null) return;
    const timer = window.setTimeout(() => setCloseConfirmationId(null), CLOSE_CONFIRMATION_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [closeConfirmationId]);

  useEffect(() => {
    setCloseConfirmationId(null);
  }, [closeConfirmationResetKey]);

  useEffect(() => {
    if (closeConfirmationId === null) return;
    function clearOnOtherOption(event: Event) {
      if (event.type === "contextmenu") {
        setCloseConfirmationId(null);
        return;
      }
      if (event.type === "keydown") {
        const key = (event as KeyboardEvent).key;
        if (key !== "Enter" && key !== " ") {
          setCloseConfirmationId(null);
          return;
        }
      }
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".note-list-close")) {
        setCloseConfirmationId(null);
      }
    }
    document.addEventListener("pointerdown", clearOnOtherOption);
    document.addEventListener("pointerup", clearOnOtherOption);
    document.addEventListener("click", clearOnOtherOption);
    document.addEventListener("keydown", clearOnOtherOption);
    document.addEventListener("focusin", clearOnOtherOption);
    document.addEventListener("contextmenu", clearOnOtherOption);
    window.addEventListener("blur", clearOnOtherOption);
    return () => {
      document.removeEventListener("pointerdown", clearOnOtherOption);
      document.removeEventListener("pointerup", clearOnOtherOption);
      document.removeEventListener("click", clearOnOtherOption);
      document.removeEventListener("keydown", clearOnOtherOption);
      document.removeEventListener("focusin", clearOnOtherOption);
      document.removeEventListener("contextmenu", clearOnOtherOption);
      window.removeEventListener("blur", clearOnOtherOption);
    };
  }, [closeConfirmationId]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!onDragStart || event.button !== 0 || !event.isPrimary || drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    handledPointerClickId.current = null;
    suppressClickId.current = null;
    drag.current = {
      id,
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      sourceBounds: {
        x: Math.round(window.screenX + bounds.left),
        y: Math.round(window.screenY + bounds.top),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
      started: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishDrag(event.pointerId, false);
      return;
    }
    if (!current.started) {
      const dx = event.screenX - current.screenX;
      const dy = event.screenY - current.screenY;
      if (Math.hypot(dx, dy) <= NOTE_DRAG_THRESHOLD) return;
      current.started = true;
      suppressClickId.current = current.id;
      listRef.current?.setPointerCapture?.(event.pointerId);
      onDragStart?.(current.id, event.screenX, event.screenY, current.sourceBounds);
    }
    onDragMove?.(current.id, event.screenX, event.screenY);
  }

  function finishDrag(pointerId: number, selectOnRelease: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== pointerId) return;
    drag.current = null;
    if (listRef.current?.hasPointerCapture?.(pointerId)) listRef.current.releasePointerCapture?.(pointerId);
    if (current.started) {
      onDragEnd?.(current.id);
    } else if (selectOnRelease) {
      handledPointerClickId.current = current.id;
      onSelect(current.id);
    }
  }

  function selectNote(id: string) {
    if (handledPointerClickId.current === id) {
      handledPointerClickId.current = null;
      return;
    }
    if (suppressClickId.current === id) {
      suppressClickId.current = null;
      return;
    }
    onSelect(id);
  }

  const draggedNote = draggingId ? notes.find((note) => note.id === draggingId) : undefined;
  let visibleIndex = 0;

  return (
    <div
      ref={listRef}
      className={`note-list${draggingId ? " is-note-dragging" : ""}`}
      role="list"
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event.pointerId, true)}
      onPointerCancel={(event) => finishDrag(event.pointerId, false)}
      onLostPointerCapture={(event) => finishDrag(event.pointerId, false)}
    >
      {notes.map((note) => {
        const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
        const isDragSource = draggingId === note.id;
        const isCloseConfirming = closeConfirmationId === note.id;
        const rowIndex = isDragSource ? -1 : visibleIndex++;
        const shiftsForDrop = dragReturnIndex !== null && dragReturnIndex !== undefined && rowIndex >= dragReturnIndex;
        return (
          <div
            key={note.id}
            role="listitem"
            data-note-id={note.id}
            className={`note-list-row${isDragSource ? " is-drag-source" : ""}`}
            style={shiftsForDrop ? { transform: "translateY(32px)" } : undefined}
          >
            <button
              type="button"
              className={`note-list-item${activeId === note.id ? " is-active" : ""}`}
              onPointerDown={(event) => onPointerDown(event, note.id)}
              onClick={() => selectNote(note.id)}
            >
              <span className="note-list-swatch" style={{ background: palette.body }} />
              <span>{note.title || "无标题"}</span>
            </button>
            {onClose && (
              <button
                type="button"
                className={`note-list-close${isCloseConfirming ? " is-confirming" : ""}`}
                aria-label={`${isCloseConfirming ? "确认关闭" : "关闭"} ${note.title || "无标题"}`}
                aria-pressed={isCloseConfirming}
                title={isCloseConfirming ? "再次点击关闭便签栏" : "关闭便签栏"}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => requestClose(note.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
      {draggedNote && dragReturnIndex !== null && dragReturnIndex !== undefined && (
        <div
          className="note-list-drop-slot"
          style={{ transform: `translateY(${dragReturnIndex * 32}px)` }}
          aria-hidden="true"
        >
          <span
            className="note-list-swatch"
            style={{ background: (noteColors[draggedNote.color as keyof typeof noteColors] ?? noteColors.lemon).body }}
          />
          <span>{draggedNote.title || "无标题"}</span>
        </div>
      )}
    </div>
  );
}

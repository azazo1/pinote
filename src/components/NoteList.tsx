import { useRef, type PointerEvent } from "react";
import { shouldStartShelfDrag } from "../lib/shelf-drag";
import type { NoteSummary } from "../types";
import { noteColors } from "./ColorPicker";

interface NoteListProps {
  notes: NoteSummary[];
  activeId?: string | null;
  draggingId?: string | null;
  onSelect: (id: string) => void;
  onDragStart?: (id: string, screenX: number, screenY: number) => void;
  onDragMove?: (id: string, screenX: number, screenY: number) => void;
  onDragEnd?: (id: string) => void;
}

interface NoteListDrag {
  id: string;
  pointerId: number;
  screenX: number;
  screenY: number;
  started: boolean;
}

export function NoteList({
  notes,
  activeId,
  draggingId,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: NoteListProps) {
  const drag = useRef<NoteListDrag | null>(null);
  const suppressClickId = useRef<string | null>(null);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!onDragStart || event.button !== 0 || !event.isPrimary || drag.current) return;
    drag.current = {
      id,
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      started: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishDrag(event.pointerId);
      return;
    }
    if (!current.started) {
      const dx = event.screenX - current.screenX;
      const dy = event.screenY - current.screenY;
      if (!shouldStartShelfDrag(dx, dy)) return;
      current.started = true;
      suppressClickId.current = current.id;
      onDragStart?.(current.id, event.screenX, event.screenY);
    }
    onDragMove?.(current.id, event.screenX, event.screenY);
  }

  function finishDrag(pointerId: number) {
    const current = drag.current;
    if (!current || current.pointerId !== pointerId) return;
    drag.current = null;
    if (current.started) onDragEnd?.(current.id);
  }

  function selectNote(id: string) {
    if (suppressClickId.current === id) {
      suppressClickId.current = null;
      return;
    }
    onSelect(id);
  }

  return (
    <div className="note-list" role="list">
      {notes.map((note) => {
        const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
        return (
          <button
            key={note.id}
            type="button"
            role="listitem"
            className={`note-list-item${activeId === note.id ? " is-active" : ""}${draggingId === note.id ? " is-dragging" : ""}`}
            onPointerDown={(event) => onPointerDown(event, note.id)}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishDrag(event.pointerId)}
            onPointerCancel={(event) => finishDrag(event.pointerId)}
            onLostPointerCapture={(event) => finishDrag(event.pointerId)}
            onClick={() => selectNote(note.id)}
          >
            <span className="note-list-swatch" style={{ background: palette.body }} />
            <span>{note.title || "无标题"}</span>
          </button>
        );
      })}
    </div>
  );
}

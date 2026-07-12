import type { NoteSummary } from "../types";
import { noteColors } from "./ColorPicker";

interface NoteListProps {
  notes: NoteSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
}

export function NoteList({ notes, activeId, onSelect }: NoteListProps) {
  return (
    <div className="note-list" role="list">
      {notes.map((note) => {
        const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
        return (
          <button
            key={note.id}
            type="button"
            role="listitem"
            className={`note-list-item${activeId === note.id ? " is-active" : ""}`}
            onClick={() => onSelect(note.id)}
          >
            <span className="note-list-swatch" style={{ background: palette.body }} />
            <span>{note.title || "无标题"}</span>
          </button>
        );
      })}
    </div>
  );
}

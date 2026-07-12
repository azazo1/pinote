import { ArrowUpRight, Pin, Trash2 } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import type { NoteSummary } from "../types";
import { noteColors } from "./ColorPicker";

interface MainNoteListProps {
  notes: NoteSummary[];
  deletingId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function MainNoteList({ notes, deletingId, onOpen, onDelete }: MainNoteListProps) {
  return (
    <div className="main-note-list" role="list">
      {notes.map((note) => (
        <MainNoteRow
          key={note.id}
          note={note}
          deleting={deletingId === note.id}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

interface MainNoteRowProps {
  note: NoteSummary;
  deleting: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function MainNoteRow({ note, deleting, onOpen, onDelete }: MainNoteRowProps) {
  const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
  const excerpt = useMemo(() => markdownExcerpt(note.markdown), [note.markdown]);
  const groupName = note.groupName.trim();
  const tags = useMemo(() => {
    const uniqueTags = new Map<string, string>();
    for (const rawTag of note.tags) {
      const tag = rawTag.trim();
      if (tag) uniqueTags.set(tag.toLowerCase(), tag);
    }
    return [...uniqueTags.values()];
  }, [note.tags]);

  return (
    <article className="main-note-row" role="listitem">
      <button className="main-note-open" type="button" onClick={() => onOpen(note.id)}>
        <span
          className="main-note-color"
          style={{ "--summary-color": palette.body, "--summary-bar": palette.bar } as CSSProperties}
          aria-hidden="true"
        />
        <span className="main-note-copy">
          <span className="main-note-title-line">
            <strong>{note.title || "无标题"}</strong>
            {note.pinned && <Pin className="main-note-pin" size={12} aria-label="已置顶" />}
            {note.open && <span className="main-note-open-state" title="窗口已打开" aria-label="窗口已打开" />}
          </span>
          <span className={`main-note-excerpt${excerpt ? "" : " is-empty"}`}>{excerpt || "空白便签"}</span>
          {(groupName || tags.length > 0) && (
            <span className="main-note-meta">
              {groupName && <span className="main-note-group" title={groupName}>{groupName}</span>}
              {tags.map((tag) => (
                <span className="main-note-tag" title={tag} key={tag.toLowerCase()}>
                  {tag.startsWith("#") ? tag : `#${tag}`}
                </span>
              ))}
            </span>
          )}
        </span>
        <time dateTime={new Date(note.modifiedAt).toISOString()}>{modifiedLabel(note.modifiedAt)}</time>
      </button>
      <div className="main-note-actions">
        <button className="main-row-action" type="button" aria-label="打开便签" title="打开便签" onClick={() => onOpen(note.id)}>
          <ArrowUpRight size={15} />
        </button>
        <button
          className="main-row-action is-danger"
          type="button"
          aria-label="删除便签"
          title="删除便签"
          disabled={deleting}
          onClick={() => onDelete(note.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function markdownExcerpt(markdown: string) {
  if (!markdown.trim()) return "";
  return markdown
    .slice(0, 4_000)
    .replace(/^\s{0,3}[-+*]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/```(?:\w+)?|`{1,3}|[*_~]{1,2}/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!~-])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function modifiedLabel(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

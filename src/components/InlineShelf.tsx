import { PanelRightOpen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { NoteSummary } from "../types";
import { IconButton } from "./IconButton";
import { NoteList } from "./NoteList";

interface InlineShelfProps {
  activeId: string;
}

export function InlineShelf({ activeId }: InlineShelfProps) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);

  useEffect(() => {
    void window.noteAPI.listNotes().then(setNotes);
    return window.noteAPI.onNoteList(setNotes);
  }, []);

  return (
    <aside className="inline-shelf" aria-label="便签列表">
      <NoteList notes={notes} activeId={activeId} onSelect={(id) => void window.noteAPI.activateDockedNote(id)} />
      <div className="inline-shelf-actions">
        <IconButton icon={Plus} label="新建便签" onClick={() => void window.noteAPI.createNote()} />
        <IconButton icon={PanelRightOpen} label="离开侧边聚群" onClick={() => void window.noteAPI.toggleGroupDock()} />
      </div>
    </aside>
  );
}

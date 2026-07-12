import { NotebookTabs, PanelRightOpen, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "./components/IconButton";
import { NoteList } from "./components/NoteList";
import type { NoteSummary } from "./types";

export default function ShelfApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void window.noteAPI.listNotes().then(setNotes);
    const offList = window.noteAPI.onNoteList(setNotes);
    const offExpanded = window.noteAPI.onShelfExpanded(setExpanded);
    return () => {
      offList();
      offExpanded();
    };
  }, []);

  return (
    <main
      className={`shelf-shell${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => {
        setExpanded(true);
        window.noteAPI.setShelfExpanded(true);
      }}
      onMouseLeave={() => window.noteAPI.hideGroup()}
    >
      <div className="shelf-handle" aria-hidden={expanded}>
        <NotebookTabs size={18} />
      </div>
      <section className="shelf-content" aria-label="侧边便签架">
        <div className="shelf-heading">
          <strong>Pinote</strong>
          <div className="shelf-actions">
            <IconButton icon={Plus} label="新建便签" onClick={() => void window.noteAPI.createNote()} />
            <IconButton icon={PanelRightOpen} label="离开侧边聚群" onClick={() => void window.noteAPI.toggleGroupDock()} />
          </div>
        </div>
        <NoteList notes={notes} onSelect={(id) => void window.noteAPI.activateDockedNote(id)} />
      </section>
    </main>
  );
}

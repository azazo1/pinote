import { NotebookTabs, PanelRightOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconButton } from "./components/IconButton";
import { NoteList } from "./components/NoteList";
import { shouldStartShelfDrag } from "./lib/shelf-drag";
import type { NoteSummary } from "./types";

interface ShelfDrag {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  windowY: number;
  moved: boolean;
}

export default function ShelfApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const drag = useRef<ShelfDrag | null>(null);
  const suppressClick = useRef(false);

  function cancelHover() {
    if (hoverTimer.current === null) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }

  function expandShelf() {
    cancelHover();
    setExpanded(true);
    window.noteAPI.setShelfExpanded(true);
  }

  function scheduleExpand() {
    if (drag.current || expanded || hoverTimer.current !== null) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (!drag.current) expandShelf();
    }, 140);
  }

  function clearDrag(forceSuppressClick = false) {
    const current = drag.current;
    if (!current) return;
    suppressClick.current ||= forceSuppressClick || current.moved;
    drag.current = null;
    setDragging(false);
    if (handleRef.current?.hasPointerCapture(current.pointerId)) {
      handleRef.current.releasePointerCapture(current.pointerId);
    }
  }

  useEffect(() => {
    void window.noteAPI.listNotes().then(setNotes);
    const offList = window.noteAPI.onNoteList(setNotes);
    const offExpanded = window.noteAPI.onShelfExpanded(setExpanded);
    return () => {
      offList();
      offExpanded();
    };
  }, []);

  useEffect(() => {
    function cancelInteraction() {
      cancelHover();
      clearDrag(true);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (hoverTimer.current !== null || drag.current) event.preventDefault();
      cancelInteraction();
    }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelInteraction);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelInteraction);
      cancelHover();
      clearDrag();
    };
  }, []);

  function onHandlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    cancelHover();
    suppressClick.current = false;
    setExpanded(false);
    window.noteAPI.setShelfExpanded(false);
    drag.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      windowY: window.screenY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.screenX - current.pointerX;
    const dy = event.screenY - current.pointerY;
    if (!current.moved && !shouldStartShelfDrag(dx, dy)) return;
    if (!current.moved) {
      current.moved = true;
      setDragging(true);
    }
    window.noteAPI.moveShelf(current.windowY + dy);
  }

  function onHandlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    clearDrag();
  }

  function onHandleClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    expandShelf();
  }

  return (
    <main
      className={`shelf-shell${expanded ? " is-expanded" : ""}${dragging ? " is-dragging" : ""}`}
      onPointerEnter={scheduleExpand}
      onPointerLeave={() => {
        cancelHover();
        if (!drag.current) window.noteAPI.hideGroup();
      }}
    >
      <button
        ref={handleRef}
        className="shelf-handle"
        type="button"
        aria-label="展开侧边便签架"
        aria-expanded={expanded}
        tabIndex={expanded ? -1 : 0}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={() => clearDrag(true)}
        onLostPointerCapture={() => clearDrag(true)}
        onClick={onHandleClick}
      >
        <NotebookTabs size={18} aria-hidden="true" />
      </button>
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

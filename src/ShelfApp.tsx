import { AppWindow, GripVertical, NotebookTabs, Plus } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconButton } from "./components/IconButton";
import { NoteList } from "./components/NoteList";
import { shouldStartShelfDrag } from "./lib/shelf-drag";
import type { NoteSummary, ShelfPlacementEdge } from "./types";

const SHELF_HOVER_EXPAND_DELAY_MS = 720;

interface ShelfDrag {
  expandsOnClick: boolean;
  handle: HTMLButtonElement;
  started: boolean;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  moved: boolean;
}

export default function ShelfApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<ShelfPlacementEdge>(() => {
    const edge = new URLSearchParams(window.location.search).get("edge");
    return edge === "left" || edge === "free" ? edge : "right";
  });
  const hoverTimer = useRef<number | null>(null);
  const drag = useRef<ShelfDrag | null>(null);
  const noteDragId = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ deltaX: number; deltaY: number } | null>(null);

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
    window.noteAPI.cancelGroupHide();
    if (drag.current || noteDragId.current || expanded || hoverTimer.current !== null) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (!drag.current) expandShelf();
    }, SHELF_HOVER_EXPAND_DELAY_MS);
  }

  const dockedNotes = notes.filter((note) => note.dockState === "shelf");

  function flushMove() {
    if (moveFrame.current !== null) {
      window.cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const next = pendingMove.current;
    pendingMove.current = null;
    if (next) window.noteAPI.moveShelf(next.deltaX, next.deltaY);
  }

  function queueMove(deltaX: number, deltaY: number) {
    pendingMove.current = { deltaX, deltaY };
    if (moveFrame.current !== null) return;
    moveFrame.current = window.requestAnimationFrame(() => {
      moveFrame.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) window.noteAPI.moveShelf(next.deltaX, next.deltaY);
    });
  }

  function clearDrag(forceSuppressClick = false) {
    const current = drag.current;
    if (!current) return;
    if (current.started) flushMove();
    else {
      if (moveFrame.current !== null) window.cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
      pendingMove.current = null;
    }
    if (current.expandsOnClick) suppressClick.current ||= forceSuppressClick || current.moved;
    drag.current = null;
    setDragging(false);
    if (current.handle.hasPointerCapture(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId);
    }
    if (current.started) window.noteAPI.endShelfMove();
    if (!current.expandsOnClick) window.noteAPI.hideGroup();
  }

  useEffect(() => {
    void window.noteAPI.listNotes().then(setNotes);
    const offList = window.noteAPI.onNoteList(setNotes);
    const offExpanded = window.noteAPI.onShelfExpanded(setExpanded);
    const offPlacement = window.noteAPI.onShelfPlacement(setPlacement);
    return () => {
      offList();
      offExpanded();
      offPlacement();
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

  function onHandlePointerDown(event: PointerEvent<HTMLButtonElement>, keepExpanded = false) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    cancelHover();
    window.noteAPI.cancelGroupHide();
    suppressClick.current = false;
    if (!keepExpanded) {
      setExpanded(false);
      window.noteAPI.setShelfExpanded(false);
    }
    drag.current = {
      expandsOnClick: !keepExpanded,
      handle: event.currentTarget,
      started: false,
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      clearDrag(true);
      return;
    }
    const dx = event.screenX - current.pointerX;
    const dy = event.screenY - current.pointerY;
    if (!current.moved && !shouldStartShelfDrag(dx, dy)) return;
    if (!current.moved) {
      current.moved = true;
      current.started = true;
      setDragging(true);
      window.noteAPI.beginShelfMove();
    }
    queueMove(dx, dy);
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

  function beginNoteDrag(id: string, screenX: number, screenY: number) {
    cancelHover();
    window.noteAPI.cancelGroupHide();
    noteDragId.current = id;
    setDraggingNoteId(id);
    window.noteAPI.beginShelfNoteDrag(id, screenX, screenY);
  }

  function moveNoteDrag(id: string, screenX: number, screenY: number) {
    window.noteAPI.moveShelfNoteDrag(id, screenX, screenY);
  }

  function endNoteDrag(id: string) {
    noteDragId.current = null;
    setDraggingNoteId(null);
    window.noteAPI.endShelfNoteDrag(id);
  }

  return (
    <main
      className={`shelf-shell is-${placement}${expanded ? " is-expanded" : ""}${dragging ? " is-dragging" : ""}`}
      onPointerEnter={scheduleExpand}
      onPointerLeave={() => {
        cancelHover();
        if (!drag.current && !noteDragId.current) window.noteAPI.hideGroup();
      }}
    >
      <button
        className="shelf-handle"
        type="button"
        aria-label="展开侧边便签架"
        aria-expanded={expanded}
        tabIndex={expanded ? -1 : 0}
        onPointerDown={(event) => onHandlePointerDown(event)}
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
          <div className="shelf-heading-title">
            <button
              className="shelf-drag-handle"
              type="button"
              aria-label="移动侧边便签架"
              title="移动侧边便签架"
              onPointerDown={(event) => onHandlePointerDown(event, true)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={() => clearDrag(true)}
              onLostPointerCapture={() => clearDrag(true)}
            >
              <GripVertical size={13} aria-hidden="true" />
            </button>
            <strong>Pinote</strong>
          </div>
          <div className="shelf-actions">
            <IconButton icon={AppWindow} label="打开主窗口" onClick={() => void window.noteAPI.openMainWindow()} />
            <IconButton icon={Plus} label="新建便签" onClick={() => void window.noteAPI.createNote()} />
          </div>
        </div>
        <NoteList
          notes={dockedNotes}
          draggingId={draggingNoteId}
          onSelect={(id) => void window.noteAPI.activateDockedNote(id)}
          onDragStart={beginNoteDrag}
          onDragMove={moveNoteDrag}
          onDragEnd={endNoteDrag}
        />
      </section>
    </main>
  );
}

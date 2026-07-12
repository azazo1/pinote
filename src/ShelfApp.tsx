import { AppWindow, GripVertical, NotebookTabs, Plus } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { IconButton } from "./components/IconButton";
import { NoteList } from "./components/NoteList";
import { shouldStartShelfDrag } from "./lib/shelf-drag";
import type { NoteSummary, ShelfPlacementEdge, WindowBounds } from "./types";

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
  const [dragReturnIndex, setDragReturnIndex] = useState<number | null>(null);
  const [shelfOrder, setShelfOrder] = useState<string[]>([]);
  const [placement, setPlacement] = useState<ShelfPlacementEdge>(() => {
    const edge = new URLSearchParams(window.location.search).get("edge");
    return edge === "left" || edge === "free" ? edge : "right";
  });
  const hoverTimer = useRef<number | null>(null);
  const drag = useRef<ShelfDrag | null>(null);
  const noteDragId = useRef<string | null>(null);
  const noteDragExited = useRef(false);
  const noteDropIndex = useRef<number | null>(null);
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

  const dockedNotes = notes
    .filter((note) => note.dockState === "shelf")
    .sort((left, right) => {
      const leftIndex = shelfOrder.indexOf(left.id);
      const rightIndex = shelfOrder.indexOf(right.id);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
        - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });

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
    function updateNotes(nextNotes: NoteSummary[]) {
      setNotes(nextNotes);
      setShelfOrder((current) => {
        const dockedIds = nextNotes.filter((note) => note.dockState === "shelf").map((note) => note.id);
        const retained = current.filter((id) => dockedIds.includes(id));
        return [...retained, ...dockedIds.filter((id) => !retained.includes(id))];
      });
    }

    void window.noteAPI.listNotes().then(updateNotes);
    const offList = window.noteAPI.onNoteList(updateNotes);
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

  function beginNoteDrag(id: string, screenX: number, screenY: number, sourceBounds: WindowBounds) {
    cancelHover();
    window.noteAPI.cancelGroupHide();
    noteDragId.current = id;
    noteDragExited.current = false;
    noteDropIndex.current = null;
    setDraggingNoteId(id);
    setDragReturnIndex(null);
    window.noteAPI.beginShelfNoteDrag(id, screenX, screenY, sourceBounds);
  }

  function moveNoteDrag(id: string, screenX: number, screenY: number) {
    const nextIndex = shelfDropIndex(id, screenX, screenY);
    if (nextIndex === null) noteDragExited.current = true;
    const returnIndex = noteDragExited.current ? nextIndex : null;
    noteDropIndex.current = returnIndex;
    setDragReturnIndex(returnIndex);
    window.noteAPI.moveShelfNoteDrag(id, screenX, screenY, returnIndex === null ? null : shelfDropTarget(returnIndex));
  }

  function endNoteDrag(id: string) {
    const dropIndex = noteDropIndex.current;
    if (dropIndex !== null) {
      setShelfOrder((current) => {
        const next = current.filter((noteId) => noteId !== id);
        next.splice(Math.min(Math.max(0, dropIndex), next.length), 0, id);
        return next;
      });
    }
    noteDragId.current = null;
    noteDragExited.current = false;
    noteDropIndex.current = null;
    setDraggingNoteId(null);
    setDragReturnIndex(null);
    window.noteAPI.endShelfNoteDrag(id);
  }

  function shelfDropIndex(id: string, screenX: number, screenY: number) {
    if (!expanded || window.innerWidth <= 52) return null;
    const clientX = screenX - window.screenX;
    const clientY = screenY - window.screenY;
    if (clientX < 0 || clientX > window.innerWidth || clientY < 0 || clientY > window.innerHeight) return null;
    const rows = [...document.querySelectorAll<HTMLElement>(".note-list-row")]
      .filter((row) => row.dataset.noteId !== id && !row.classList.contains("is-drag-source"));
    const index = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.offsetHeight / 2);
    return index < 0 ? rows.length : index;
  }

  function shelfDropTarget(index: number): WindowBounds | null {
    const list = document.querySelector<HTMLElement>(".note-list");
    if (!list) return null;
    const bounds = list.getBoundingClientRect();
    return {
      x: Math.round(window.screenX + bounds.left),
      y: Math.round(window.screenY + bounds.top - list.scrollTop + index * 32),
      width: Math.round(bounds.width),
      height: 32,
    };
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
          dragReturnIndex={dragReturnIndex}
          onSelect={(id) => void window.noteAPI.activateDockedNote(id)}
          onClose={(id) => void window.noteAPI.closeDockedNote(id)}
          onDragStart={beginNoteDrag}
          onDragMove={moveNoteDrag}
          onDragEnd={endNoteDrag}
        />
      </section>
    </main>
  );
}

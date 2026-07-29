import { AppWindow, GripVertical, NotebookTabs, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { NoteWorkspace, type NoteWorkspaceHandle } from "./App";
import { IconButton } from "./components/IconButton";
import { NoteList } from "./components/NoteList";
import { shouldStartShelfDrag } from "./lib/shelf-drag";
import type { NoteSummary, ShelfPlacementEdge, ShelfWorkspaceMetrics, WindowBounds } from "./types";

const SHELF_HOVER_EXPAND_DELAY_MS = 720;
const SHELF_REPEAT_CLICK_IDLE_MS = 500;

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hostedId, setHostedId] = useState<string | null>(null);
  const [initialTitleFocusId, setInitialTitleFocusId] = useState<string | null>(null);
  const [repeatClickGuard, setRepeatClickGuard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragReturnIndex, setDragReturnIndex] = useState<number | null>(null);
  const [shelfOrder, setShelfOrder] = useState<string[]>([]);
  const [placement, setPlacement] = useState<ShelfPlacementEdge>(() => {
    const edge = new URLSearchParams(window.location.search).get("edge");
    return edge === "left" || edge === "free" ? edge : "right";
  });
  const [workspace, setWorkspace] = useState<ShelfWorkspaceMetrics>({
    editorSide: placement === "right" ? "left" : "right",
    editorWidth: 360,
    editorHeight: 300,
  });
  const workspaceRef = useRef<NoteWorkspaceHandle>(null);
  const hoverTimer = useRef<number | null>(null);
  const repeatClickGuardTimer = useRef<number | null>(null);
  const drag = useRef<ShelfDrag | null>(null);
  const noteDragId = useRef<string | null>(null);
  const noteDragReady = useRef(false);
  const noteDragReleasePending = useRef(false);
  const pendingNoteDragMove = useRef<{ id: string; screenX: number; screenY: number } | null>(null);
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

  function clearRepeatClickGuard() {
    if (repeatClickGuardTimer.current !== null) {
      window.clearTimeout(repeatClickGuardTimer.current);
      repeatClickGuardTimer.current = null;
    }
    setRepeatClickGuard(false);
  }

  function startRepeatClickGuard() {
    if (repeatClickGuardTimer.current !== null) window.clearTimeout(repeatClickGuardTimer.current);
    setRepeatClickGuard(true);
    repeatClickGuardTimer.current = window.setTimeout(() => {
      repeatClickGuardTimer.current = null;
      setRepeatClickGuard(false);
    }, SHELF_REPEAT_CLICK_IDLE_MS);
  }

  function expandShelf(protectFromRepeatClick = false) {
    cancelHover();
    if (protectFromRepeatClick) startRepeatClickGuard();
    setExpanded(true);
    void window.noteAPI.setShelfExpanded(true);
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
    .filter((note) => note.archivedAt === null && note.dockState === "shelf")
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
        const dockedIds = nextNotes
          .filter((note) => note.archivedAt === null && note.dockState === "shelf")
          .map((note) => note.id);
        const retained = current.filter((id) => dockedIds.includes(id));
        return [...retained, ...dockedIds.filter((id) => !retained.includes(id))];
      });
    }

    void window.noteAPI.listNotes(true).then(updateNotes);
    const offList = window.noteAPI.onNoteList(updateNotes);
    const offExpanded = window.noteAPI.onShelfExpanded((nextExpanded) => {
      setExpanded(nextExpanded);
      if (!nextExpanded) clearRepeatClickGuard();
    });
    const offPlacement = window.noteAPI.onShelfPlacement(setPlacement);
    const offGroup = window.noteAPI.onGroupState((state) => {
      setActiveId(state.activeId);
      if (state.activeId) setHostedId(state.activeId);
      else setHostedId((current) => current && state.dockedIds.includes(current) ? current : null);
    });
    const offWorkspace = window.noteAPI.onShelfWorkspace(setWorkspace);
    return () => {
      offList();
      offExpanded();
      offPlacement();
      offGroup();
      offWorkspace();
    };
  }, []);

  useEffect(() => {
    if (!expanded || !activeId || activeId !== hostedId || activeId === initialTitleFocusId) return;
    const frame = window.requestAnimationFrame(() => workspaceRef.current?.focusEditor());
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, expanded, hostedId, initialTitleFocusId]);

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
      if (repeatClickGuardTimer.current !== null) window.clearTimeout(repeatClickGuardTimer.current);
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
      void window.noteAPI.setShelfExpanded(false);
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
    expandShelf(true);
  }

  function beginNoteDrag(id: string, screenX: number, screenY: number, sourceBounds: WindowBounds) {
    if (noteDragId.current) return;
    cancelHover();
    window.noteAPI.cancelGroupHide();
    noteDragId.current = id;
    noteDragReady.current = false;
    noteDragReleasePending.current = false;
    pendingNoteDragMove.current = null;
    noteDragExited.current = false;
    noteDropIndex.current = null;
    setDraggingNoteId(id);
    setDragReturnIndex(null);
    void (async () => {
      if (activeId === id) await workspaceRef.current?.flush();
      const started = await window.noteAPI.beginShelfNoteDrag(id, screenX, screenY, sourceBounds);
      if (noteDragId.current !== id) return;
      if (!started) {
        clearNoteDragState();
        return;
      }
      noteDragReady.current = true;
      const pending = pendingNoteDragMove.current;
      pendingNoteDragMove.current = null;
      if (pending) sendNoteDragMove(pending.id, pending.screenX, pending.screenY);
      if (noteDragReleasePending.current) finishNoteDrag(id);
    })().catch(() => clearNoteDragState());
  }

  function moveNoteDrag(id: string, screenX: number, screenY: number) {
    if (!noteDragReady.current) {
      pendingNoteDragMove.current = { id, screenX, screenY };
      return;
    }
    sendNoteDragMove(id, screenX, screenY);
  }

  function sendNoteDragMove(id: string, screenX: number, screenY: number) {
    const nextIndex = shelfDropIndex(id, screenX, screenY);
    if (nextIndex === null) noteDragExited.current = true;
    const returnIndex = noteDragExited.current ? nextIndex : null;
    noteDropIndex.current = returnIndex;
    setDragReturnIndex(returnIndex);
    window.noteAPI.moveShelfNoteDrag(id, screenX, screenY, returnIndex === null ? null : shelfDropTarget(returnIndex));
  }

  function endNoteDrag(id: string) {
    if (!noteDragReady.current) {
      noteDragReleasePending.current = true;
      return;
    }
    finishNoteDrag(id);
  }

  function finishNoteDrag(id: string) {
    const dropIndex = noteDropIndex.current;
    if (dropIndex !== null) {
      setShelfOrder((current) => {
        const next = current.filter((noteId) => noteId !== id);
        next.splice(Math.min(Math.max(0, dropIndex), next.length), 0, id);
        return next;
      });
    }
    clearNoteDragState();
    window.noteAPI.endShelfNoteDrag(id);
  }

  function clearNoteDragState() {
    noteDragId.current = null;
    noteDragReady.current = false;
    noteDragReleasePending.current = false;
    pendingNoteDragMove.current = null;
    noteDragExited.current = false;
    noteDropIndex.current = null;
    setDraggingNoteId(null);
    setDragReturnIndex(null);
  }

  async function selectNote(id: string) {
    if (activeId && activeId !== id) await workspaceRef.current?.flush();
    setInitialTitleFocusId(null);
    await window.noteAPI.activateDockedNote(id);
  }

  async function createNote() {
    const note = await window.noteAPI.createDockedNote();
    setInitialTitleFocusId(note.id);
  }

  async function closeNote(id: string) {
    if (hostedId === id) await workspaceRef.current?.flush();
    await window.noteAPI.closeDockedNote(id);
    if (hostedId === id) setHostedId(null);
  }

  function shelfDropIndex(id: string, screenX: number, screenY: number) {
    if (!expanded || window.innerWidth <= 52) return null;
    const clientY = screenY - window.screenY;
    const content = document.querySelector<HTMLElement>(".shelf-content");
    if (!content) return null;
    const contentBounds = content.getBoundingClientRect();
    const clientX = screenX - window.screenX;
    if (
      clientX < contentBounds.left
      || clientX > contentBounds.right
      || clientY < contentBounds.top
      || clientY > contentBounds.bottom
    ) return null;
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
      className={`shelf-shell is-${placement}${expanded ? " is-expanded" : ""}${activeId ? ` has-editor is-editor-${workspace.editorSide}` : ""}${dragging ? " is-dragging" : ""}`}
      style={{
        "--shelf-editor-width": `${workspace.editorWidth}px`,
        "--shelf-editor-height": `${workspace.editorHeight}px`,
      } as CSSProperties}
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
      {expanded && repeatClickGuard && (
        <span
          className="shelf-repeat-click-guard"
          aria-hidden="true"
          onPointerDown={startRepeatClickGuard}
        />
      )}
      <div className="shelf-workspace">
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
              <IconButton icon={Plus} label="新建便签" onClick={() => void createNote()} />
            </div>
          </div>
          <NoteList
            notes={dockedNotes}
            activeId={activeId}
            closeConfirmationResetKey={expanded}
            draggingId={draggingNoteId}
            dragReturnIndex={dragReturnIndex}
            onSelect={(id) => void selectNote(id)}
            onClose={(id) => void closeNote(id)}
            onDragStart={beginNoteDrag}
            onDragMove={moveNoteDrag}
            onDragEnd={endNoteDrag}
          />
        </section>
        {hostedId && (
          <section className={`shelf-editor${activeId === hostedId ? " is-active" : ""}`} aria-label="侧边便签编辑区">
            <NoteWorkspace
              key={hostedId}
              ref={workspaceRef}
              noteId={hostedId}
              initialFocus={initialTitleFocusId === hostedId ? "title" : null}
              presentation="shelf"
              onEmbeddedDragStart={(screenX, screenY, sourceBounds) => (
                beginNoteDrag(hostedId, screenX, screenY, sourceBounds)
              )}
              onEmbeddedDragMove={(screenX, screenY) => moveNoteDrag(hostedId, screenX, screenY)}
              onEmbeddedDragEnd={() => endNoteDrag(hostedId)}
            />
          </section>
        )}
      </div>
    </main>
  );
}

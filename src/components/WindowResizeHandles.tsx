import { useEffect, useRef, type PointerEvent } from "react";
import {
  NOTE_RESIZE_EDGES,
  resizeWindowBounds,
  type NoteResizeEdge,
  type WindowBounds,
} from "../lib/window-resize";

interface WindowResizeHandlesProps {
  noteId: string;
}

interface ResizeDrag {
  edge: NoteResizeEdge;
  handle: HTMLDivElement;
  started: boolean;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  bounds: WindowBounds;
}

export function WindowResizeHandles({ noteId }: WindowResizeHandlesProps) {
  const drag = useRef<ResizeDrag | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ edge: NoteResizeEdge; bounds: WindowBounds } | null>(null);

  function flushResize() {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (next) window.noteAPI.resizeWindow(noteId, next.edge, next.bounds);
  }

  function clearResize() {
    const current = drag.current;
    drag.current = null;
    if (current?.started) flushResize();
    else {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
    }
    if (current?.handle.hasPointerCapture(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId);
    }
    if (current?.started) window.noteAPI.endWindowResize(noteId);
  }

  useEffect(() => {
    function cancelInteraction() {
      clearResize();
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      cancelInteraction();
    }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelInteraction);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelInteraction);
      clearResize();
    };
  }, []);

  function queueResize(edge: NoteResizeEdge, bounds: WindowBounds) {
    pending.current = { edge, bounds };
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const next = pending.current;
      pending.current = null;
      if (next) window.noteAPI.resizeWindow(noteId, next.edge, next.bounds);
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>, edge: NoteResizeEdge) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const bounds = {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    drag.current = {
      edge,
      handle: event.currentTarget,
      started: false,
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      bounds,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      clearResize();
      return;
    }
    if (!current.started) {
      const delta = Math.abs(event.screenX - current.pointerX) + Math.abs(event.screenY - current.pointerY);
      if (delta < 2) return;
      current.started = true;
      current.bounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      window.noteAPI.beginWindowResize(noteId);
    }
    queueResize(current.edge, resizeWindowBounds(
      current.bounds,
      current.edge,
      event.screenX - current.pointerX,
      event.screenY - current.pointerY,
    ));
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    clearResize();
  }

  return NOTE_RESIZE_EDGES.map((edge) => (
    <div
      key={edge}
      className="window-resize-handle"
      data-resize-edge={edge}
      aria-hidden="true"
      onPointerDown={(event) => onPointerDown(event, edge)}
      onPointerMove={onPointerMove}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={() => clearResize()}
    />
  ));
}

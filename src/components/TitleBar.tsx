import { PanelRightClose, PanelRightOpen, Pin, X } from "lucide-react";
import { useRef, type PointerEvent } from "react";
import { shouldStartShelfDrag } from "../lib/shelf-drag";
import type { WindowBounds } from "../types";
import { IconButton } from "./IconButton";

interface TitleBarProps {
  noteId: string;
  title: string;
  pinned: boolean;
  docked: boolean;
  archived: boolean;
  onToggleDock: () => void;
  onTogglePinned: () => void;
  onClose: () => void;
  onCollapse: () => void;
  nativeDrag?: boolean;
  embedded?: boolean;
  onEmbeddedDragStart?: (screenX: number, screenY: number, sourceBounds: WindowBounds) => void;
  onEmbeddedDragMove?: (screenX: number, screenY: number) => void;
  onEmbeddedDragEnd?: () => void;
}

export function TitleBar(props: TitleBarProps) {
  const drag = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    windowX: number;
    windowY: number;
    moved: boolean;
    sourceBounds: WindowBounds | null;
  } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (props.nativeDrag || event.button !== 0 || !event.isPrimary) return;
    if (props.embedded && !props.onEmbeddedDragStart) return;
    const noteBounds = event.currentTarget.closest<HTMLElement>(".note-shell")?.getBoundingClientRect();
    if (props.embedded && !noteBounds) return;
    drag.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      windowX: window.screenX,
      windowY: window.screenY,
      moved: false,
      sourceBounds: props.embedded && noteBounds ? {
        x: Math.round(window.screenX + noteBounds.left),
        y: Math.round(window.screenY + noteBounds.top),
        width: Math.round(noteBounds.width),
        height: Math.round(noteBounds.height),
      } : null,
    };
    if (!props.embedded) window.noteAPI.beginWindowMove(props.noteId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (props.nativeDrag || !current || current.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishPointerDrag(event);
      return;
    }
    const dx = event.screenX - current.pointerX;
    const dy = event.screenY - current.pointerY;
    if (!current.moved) {
      const shouldStart = props.embedded ? shouldStartShelfDrag(dx, dy) : Math.abs(dx) + Math.abs(dy) > 4;
      if (!shouldStart) return;
      current.moved = true;
      if (props.embedded && current.sourceBounds) {
        props.onEmbeddedDragStart?.(event.screenX, event.screenY, current.sourceBounds);
      }
    }
    if (props.embedded) {
      event.preventDefault();
      props.onEmbeddedDragMove?.(event.screenX, event.screenY);
    } else {
      window.noteAPI.moveWindow(
        props.noteId,
        current.windowX + dx,
        current.windowY + dy,
        event.screenX,
        event.screenY,
      );
    }
  }

  function finishPointerDrag(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (props.nativeDrag || !current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (props.embedded) {
      if (current.moved) props.onEmbeddedDragEnd?.();
    } else {
      window.noteAPI.endWindowMove(props.noteId);
    }
  }

  return (
    <header
      className={`title-bar${props.nativeDrag ? " uses-native-drag" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onLostPointerCapture={finishPointerDrag}
      onDoubleClick={props.onCollapse}
    >
      <span className="collapsed-title">{props.title || "无标题"}</span>
      <div className="window-actions">
        {!props.archived && (
          <IconButton
            icon={props.docked ? PanelRightOpen : PanelRightClose}
            label={props.docked ? "移出侧边" : "收纳到侧边"}
            active={props.docked}
            onClick={props.onToggleDock}
          />
        )}
        <IconButton icon={Pin} label="置顶" active={props.pinned} onClick={props.onTogglePinned} />
        <IconButton icon={X} label="关闭便签" onClick={props.onClose} />
      </div>
    </header>
  );
}

import { Palette, Pin, X } from "lucide-react";
import { useRef, type PointerEvent } from "react";
import { IconButton } from "./IconButton";

interface TitleBarProps {
  noteId: string;
  title: string;
  pinned: boolean;
  colorPickerOpen: boolean;
  onToggleColorPicker: () => void;
  onTogglePinned: () => void;
  onDelete: () => void;
  onCollapse: () => void;
  nativeDrag?: boolean;
}

export function TitleBar(props: TitleBarProps) {
  const drag = useRef<{ pointerX: number; pointerY: number; windowX: number; windowY: number; moved: boolean } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (props.nativeDrag) return;
    if (event.button !== 0) return;
    drag.current = {
      pointerX: event.screenX,
      pointerY: event.screenY,
      windowX: window.screenX,
      windowY: window.screenY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (props.nativeDrag) return;
    if (!drag.current) return;
    const dx = event.screenX - drag.current.pointerX;
    const dy = event.screenY - drag.current.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    if (drag.current.moved) {
      window.noteAPI.moveWindow(props.noteId, drag.current.windowX + dx, drag.current.windowY + dy);
    }
  }

  function onPointerUp() {
    if (props.nativeDrag) return;
    if (!drag.current) return;
    drag.current = null;
  }

  return (
    <header
      className={`title-bar${props.nativeDrag ? " uses-native-drag" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={props.onCollapse}
    >
      <span className="collapsed-title">{props.title || "无标题"}</span>
      <div className="window-actions">
        <IconButton icon={Palette} label="便签颜色" active={props.colorPickerOpen} onClick={props.onToggleColorPicker} />
        <IconButton icon={Pin} label="置顶" active={props.pinned} onClick={props.onTogglePinned} />
        <IconButton icon={X} label="删除便签" danger onClick={props.onDelete} />
      </div>
    </header>
  );
}

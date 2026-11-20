import { Ellipsis } from "lucide-react";
import { useRef } from "react";
import type { NoteMenuAction } from "../types";

interface NoteMenuProps {
  onCreate: () => void;
  onOpenColorPicker: () => void;
  onOpenMainWindow: () => void;
  onOpenSync: () => void;
  archived: boolean;
  onToggleArchive: () => void;
  localOnly: boolean;
  onToggleLocalOnly: () => void;
  onDelete: () => void;
}

function runAction(action: NoteMenuAction, props: NoteMenuProps) {
  switch (action) {
    case "create-note": props.onCreate(); break;
    case "open-color-picker": props.onOpenColorPicker(); break;
    case "open-main-window": props.onOpenMainWindow(); break;
    case "open-sync": props.onOpenSync(); break;
    case "toggle-local-only": props.onToggleLocalOnly(); break;
    case "toggle-archive": props.onToggleArchive(); break;
    case "delete-note": props.onDelete(); break;
  }
}

// 便签窗口可能缩得很小, 因此菜单交给系统弹出, 不受窗口边界裁切.
export function NoteMenu(props: NoteMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  async function openMenu() {
    if (busyRef.current) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    busyRef.current = true;
    try {
      const action = await window.noteAPI.showNoteMenu({
        archived: props.archived,
        localOnly: props.localOnly,
        anchor: rect ? { x: rect.left, y: rect.top } : null,
      });
      if (action) runAction(action, props);
    } catch {
      // 菜单无法弹出时保持便签原状, 不打断编辑.
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <button
      ref={triggerRef}
      className="icon-button note-menu-trigger"
      type="button"
      aria-label="便签操作"
      title="便签操作"
      aria-haspopup="menu"
      onClick={() => void openMenu()}
    >
      <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

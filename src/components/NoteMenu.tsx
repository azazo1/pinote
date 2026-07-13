import {
  AppWindow,
  ArchiveRestore,
  CircleCheckBig,
  Cloud,
  Ellipsis,
  Palette,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

interface NoteMenuProps {
  onCreate: () => void;
  onOpenColorPicker: () => void;
  onOpenMainWindow: () => void;
  onOpenSync: () => void;
  archived: boolean;
  onToggleArchive: () => void;
  onDelete: () => void;
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

function MenuItem({ icon: Icon, label, danger, onSelect }: MenuItemProps) {
  return (
    <button
      className={`note-menu-item${danger ? " is-danger" : ""}`}
      type="button"
      role="menuitem"
      onClick={onSelect}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function NoteMenu(props: NoteMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function select(action: () => void) {
    setOpen(false);
    action();
  }

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") items[0].focus();
    else if (event.key === "End") items[items.length - 1].focus();
    else if (event.key === "ArrowDown") items[current < 0 ? 0 : (current + 1) % items.length].focus();
    else items[current <= 0 ? items.length - 1 : current - 1].focus();
  }

  return (
    <div ref={rootRef} className="note-menu-root">
      <button
        ref={triggerRef}
        className={`icon-button note-menu-trigger${open ? " is-active" : ""}`}
        type="button"
        aria-label="便签操作"
        title="便签操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="note-menu"
          role="menu"
          aria-label="便签操作"
          onKeyDown={navigateMenu}
        >
          <MenuItem icon={Plus} label="新建便签" onSelect={() => select(props.onCreate)} />
          <MenuItem icon={Palette} label="便签颜色" onSelect={() => select(props.onOpenColorPicker)} />
          <MenuItem icon={AppWindow} label="打开主窗口" onSelect={() => select(props.onOpenMainWindow)} />
          <MenuItem icon={Cloud} label="云同步" onSelect={() => select(props.onOpenSync)} />
          <div className="note-menu-separator" role="separator" />
          <MenuItem
            icon={props.archived ? ArchiveRestore : CircleCheckBig}
            label={props.archived ? "恢复为活跃便签" : "标记完成"}
            onSelect={() => select(props.onToggleArchive)}
          />
          <MenuItem icon={Trash2} label="删除便签" danger onSelect={() => select(props.onDelete)} />
        </div>
      )}
    </div>
  );
}

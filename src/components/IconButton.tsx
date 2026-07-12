import type { ComponentType, MouseEventHandler } from "react";

interface IconButtonProps {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

export function IconButton({ icon: Icon, label, active, danger, onClick }: IconButtonProps) {
  return (
    <button
      className={`icon-button${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

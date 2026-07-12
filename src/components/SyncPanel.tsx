import { X } from "lucide-react";
import type { SyncStatus } from "../types";
import { IconButton } from "./IconButton";
import { SyncSettingsForm } from "./settings/SyncSettingsForm";

interface SyncPanelProps {
  status: SyncStatus;
  onClose: () => void;
  onStatus: (status: SyncStatus) => void;
}

export function SyncPanel({ status, onClose, onStatus }: SyncPanelProps) {
  return (
    <section className="sync-panel" aria-label="同步设置">
      <div className="sync-panel-heading">
        <strong>同步</strong>
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </div>
      <SyncSettingsForm status={status} onStatus={onStatus} compact />
    </section>
  );
}

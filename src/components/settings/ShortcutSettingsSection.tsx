import { RotateCcw, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { AppSettings, ShortcutCommandId, ShortcutSetting } from "../../types";

interface ShortcutSettingsSectionProps {
  shortcuts: ShortcutSetting[];
  platform: string;
  onSettings: (settings: AppSettings) => void;
}

const groupLabels = {
  main: "主窗口",
  window: "窗口",
  note: "便签",
} as const;

export function ShortcutSettingsSection({ shortcuts, platform, onSettings }: ShortcutSettingsSectionProps) {
  const [recording, setRecording] = useState<ShortcutCommandId | null>(null);
  const [busy, setBusy] = useState<ShortcutCommandId | "all" | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ShortcutCommandId, string>>>({});

  async function update(id: ShortcutCommandId, patch: { accelerator?: string | null; global?: boolean }) {
    setBusy(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      onSettings(await window.noteAPI.updateShortcut(id, patch));
      setRecording(null);
    } catch (reason) {
      setErrors((current) => ({ ...current, [id]: errorMessage(reason) }));
    } finally {
      setBusy(null);
    }
  }

  async function reset(id: ShortcutCommandId) {
    setBusy(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      onSettings(await window.noteAPI.resetShortcut(id));
    } catch (reason) {
      setErrors((current) => ({ ...current, [id]: errorMessage(reason) }));
    } finally {
      setBusy(null);
    }
  }

  async function resetAll() {
    setBusy("all");
    setErrors({});
    try {
      onSettings(await window.noteAPI.resetShortcuts());
    } catch (reason) {
      const message = errorMessage(reason);
      setErrors(Object.fromEntries(shortcuts.map((shortcut) => [shortcut.id, message])));
    } finally {
      setBusy(null);
    }
  }

  function capture(event: KeyboardEvent<HTMLButtonElement>, id: ShortcutCommandId) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      return;
    }
    const accelerator = keyboardEventToAccelerator(event, platform);
    if (!accelerator) {
      if (!isModifierKey(event.key)) {
        setErrors((current) => ({ ...current, [id]: "请同时按下 Ctrl, Command 或 Alt" }));
      }
      return;
    }
    void update(id, { accelerator });
  }

  return (
    <div className="settings-section-body settings-shortcuts-section">
      <header className="settings-section-heading settings-heading-with-action">
        <div>
          <h1>快捷键</h1>
          <p>点击键位后直接按下新的组合键</p>
        </div>
        <button className="settings-text-command" type="button" disabled={busy !== null} onClick={() => void resetAll()}>
          <RotateCcw size={14} />
          恢复全部默认
        </button>
      </header>

      {(Object.keys(groupLabels) as Array<keyof typeof groupLabels>).map((group) => {
        const commands = shortcuts.filter((shortcut) => shortcut.group === group);
        if (commands.length === 0) return null;
        return (
          <section className="settings-group shortcut-group" key={group} aria-labelledby={`shortcut-${group}`}>
            <h2 id={`shortcut-${group}`}>{groupLabels[group]}</h2>
            <div className="shortcut-list">
              {commands.map((shortcut) => (
                <div className="shortcut-row" key={shortcut.id}>
                  <div className="shortcut-name">
                    <strong>{shortcut.label}</strong>
                    {errors[shortcut.id] && <span role="alert">{errors[shortcut.id]}</span>}
                  </div>
                  <button
                    className={`shortcut-recorder${recording === shortcut.id ? " is-recording" : ""}`}
                    type="button"
                    disabled={busy !== null && busy !== shortcut.id}
                    aria-label={`${shortcut.label}快捷键`}
                    onClick={() => setRecording(shortcut.id)}
                    onBlur={() => setRecording((current) => current === shortcut.id ? null : current)}
                    onKeyDown={(event) => capture(event, shortcut.id)}
                  >
                    {recording === shortcut.id ? "请按组合键" : formatAccelerator(shortcut.accelerator, platform)}
                  </button>
                  <button
                    className="settings-icon-command"
                    type="button"
                    aria-label={`清除${shortcut.label}快捷键`}
                    title="清除快捷键"
                    disabled={!shortcut.accelerator || busy !== null}
                    onClick={() => void update(shortcut.id, { accelerator: null, global: false })}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className="settings-icon-command"
                    type="button"
                    aria-label={`恢复${shortcut.label}默认键位`}
                    title="恢复默认"
                    disabled={busy !== null}
                    onClick={() => void reset(shortcut.id)}
                  >
                    <RotateCcw size={14} />
                  </button>
                  <label className={`shortcut-global${!shortcut.globalEligible ? " is-unavailable" : ""}`} title="允许 Pinote 未聚焦时触发">
                    <input
                      type="checkbox"
                      checked={shortcut.global}
                      disabled={!shortcut.globalEligible || !shortcut.accelerator || busy !== null}
                      onChange={(event) => void update(shortcut.id, { global: event.target.checked })}
                    />
                    <span>全局</span>
                  </label>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function keyboardEventToAccelerator(event: KeyboardEvent, platform: string) {
  if (isModifierKey(event.key)) return null;
  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push(platform === "darwin" ? "Command" : "Super");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  const key = acceleratorKey(event.key);
  return key ? [...modifiers, key].join("+") : null;
}

function acceleratorKey(key: string) {
  const names: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Tab: "Tab",
    " ": "Space",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    "+": "Plus",
  };
  if (names[key]) return names[key];
  if (/^[a-z0-9]$/i.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return key.toUpperCase();
  if ([",", ".", "/", ";", "'", "[", "]", "\\", "-", "="].includes(key)) return key;
  return null;
}

function isModifierKey(key: string) {
  return ["Meta", "Control", "Alt", "Shift"].includes(key);
}

function formatAccelerator(accelerator: string | null, platform: string) {
  if (!accelerator) return "未设置";
  return accelerator
    .replace("CommandOrControl", platform === "darwin" ? "Cmd" : "Ctrl")
    .replace("Command", "Cmd")
    .replace("Control", "Ctrl")
    .replace("Super", platform === "darwin" ? "Cmd" : "Super");
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "快捷键保存失败";
}

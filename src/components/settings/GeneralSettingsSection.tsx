import { Check } from "lucide-react";
import { useState } from "react";
import { noteColors } from "../ColorPicker";
import type { AppSettings, GeneralSettings } from "../../types";

interface GeneralSettingsSectionProps {
  settings: GeneralSettings;
  onSettings: (settings: AppSettings) => void;
}

const colorLabels: Record<string, string> = {
  lemon: "柠檬黄",
  mint: "薄荷绿",
  coral: "珊瑚粉",
  sky: "天空蓝",
  paper: "纸张白",
};

export function GeneralSettingsSection({ settings, onSettings }: GeneralSettingsSectionProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function update(
    key: keyof Omit<GeneralSettings, "launchAtLoginSupported" | "hideDockOnMainCloseSupported">,
    value: boolean | string,
  ) {
    setBusy(key);
    setError("");
    try {
      onSettings(await window.noteAPI.updateGeneralSettings({ [key]: value }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-section-body">
      <header className="settings-section-heading">
        <h1>通用</h1>
        <p>控制应用启动, 托盘行为和新便签默认值</p>
      </header>

      {error && <div className="settings-inline-error" role="alert">{error}</div>}

      <section className="settings-group" aria-labelledby="startup-settings-heading">
        <h2 id="startup-settings-heading">启动与托盘</h2>
        <SettingToggle
          label="登录时启动"
          description={settings.launchAtLoginSupported ? "登录系统后自动运行 Pinote" : "当前系统暂不支持此功能"}
          checked={settings.launchAtLogin}
          disabled={!settings.launchAtLoginSupported || busy === "launchAtLogin"}
          onChange={(checked) => void update("launchAtLogin", checked)}
        />
        <SettingToggle
          label="登录启动后显示主窗口"
          description="手动启动时始终显示主窗口"
          checked={settings.showMainOnLogin}
          disabled={busy === "showMainOnLogin"}
          onChange={(checked) => void update("showMainOnLogin", checked)}
        />
        <SettingToggle
          label="关闭主窗口时隐藏到托盘"
          description="关闭后继续运行后台同步"
          checked={settings.closeMainToTray}
          disabled={busy === "closeMainToTray"}
          onChange={(checked) => void update("closeMainToTray", checked)}
        />
        {settings.hideDockOnMainCloseSupported && (
          <SettingToggle
            label="关闭主窗口后隐藏 Dock 图标"
            description="从托盘重新打开主窗口时恢复显示"
            checked={settings.hideDockOnMainClose}
            disabled={busy === "hideDockOnMainClose"}
            onChange={(checked) => void update("hideDockOnMainClose", checked)}
          />
        )}
      </section>

      <section className="settings-group" aria-labelledby="note-defaults-heading">
        <h2 id="note-defaults-heading">新便签默认值</h2>
        <div className="settings-field-row">
          <div className="settings-field-copy">
            <strong>默认颜色</strong>
            <span>只影响之后创建的便签</span>
          </div>
          <div className="settings-color-options" role="radiogroup" aria-label="新便签默认颜色">
            {Object.entries(noteColors).map(([name, color]) => (
              <button
                key={name}
                className="settings-color-swatch"
                type="button"
                role="radio"
                aria-label={colorLabels[name] ?? name}
                aria-checked={settings.defaultNoteColor === name}
                title={colorLabels[name] ?? name}
                disabled={busy === "defaultNoteColor"}
                style={{ backgroundColor: color.body }}
                onClick={() => void update("defaultNoteColor", name)}
              >
                {settings.defaultNoteColor === name && <Check size={14} strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        </div>
        <SettingToggle
          label="默认置顶"
          description="新便签创建后保持在其他窗口上方"
          checked={settings.defaultNotePinned}
          disabled={busy === "defaultNotePinned"}
          onChange={(checked) => void update("defaultNotePinned", checked)}
        />
      </section>
    </div>
  );
}

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function SettingToggle({ label, description, checked, disabled, onChange }: SettingToggleProps) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-field-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <input
        className="settings-switch-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "设置保存失败";
}

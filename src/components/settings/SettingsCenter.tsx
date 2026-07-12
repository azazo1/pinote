import { Cloud, Info, Keyboard, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppInfo, AppSettings, SyncStatus } from "../../types";
import { AboutSettingsSection } from "./AboutSettingsSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { ShortcutSettingsSection } from "./ShortcutSettingsSection";
import { SyncSettingsForm } from "./SyncSettingsForm";

export type SettingsSection = "general" | "shortcuts" | "sync" | "about";

interface SettingsCenterProps {
  section: SettingsSection;
  status: SyncStatus;
  onSection: (section: SettingsSection) => void;
  onStatus: (status: SyncStatus) => void;
}

const sections = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "sync", label: "云同步", icon: Cloud },
  { id: "about", label: "关于", icon: Info },
] as const;

export function SettingsCenter({ section, status, onSection, onStatus }: SettingsCenterProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void Promise.all([window.noteAPI.getAppSettings(), window.noteAPI.getAppInfo()])
      .then(([nextSettings, nextInfo]) => {
        setSettings(nextSettings);
        setInfo(nextInfo);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : "设置加载失败"));
    return window.noteAPI.onAppSettings(setSettings);
  }, []);

  return (
    <section className="settings-center" aria-label="设置">
      <nav className="settings-nav" aria-label="设置分类">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? "page" : undefined}
            onClick={() => onSection(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {loadError && <div className="settings-load-error" role="alert">{loadError}</div>}
        {!settings || !info ? (
          !loadError && <div className="settings-loading">正在加载设置</div>
        ) : section === "general" ? (
          <GeneralSettingsSection settings={settings.general} onSettings={setSettings} />
        ) : section === "shortcuts" ? (
          <ShortcutSettingsSection shortcuts={settings.shortcuts} platform={info.platform} onSettings={setSettings} />
        ) : section === "sync" ? (
          <div className="settings-section-body">
            <header className="settings-section-heading">
              <h1>云同步</h1>
              <p>连接自托管 Pinote 同步服务</p>
            </header>
            <section className="settings-group" aria-label="云同步连接">
              <SyncSettingsForm status={status} onStatus={onStatus} />
            </section>
          </div>
        ) : (
          <AboutSettingsSection info={info} />
        )}
      </div>
    </section>
  );
}

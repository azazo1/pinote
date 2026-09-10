import { useEffect, useState } from "react";
import { displayVersion, statusDetail, statusHeadline } from "../../lib/update-status";
import type { AppInfo, AppSettings, GeneralSettings, UpdateSnapshot } from "../../types";

interface AboutSettingsSectionProps {
  info: AppInfo;
  settings: GeneralSettings;
  onSettings: (settings: AppSettings) => void;
}

export function AboutSettingsSection({ info, settings, onSettings }: AboutSettingsSectionProps) {
  const [update, setUpdate] = useState<UpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.noteAPI.getUpdateState().then(setUpdate);
    return window.noteAPI.onUpdateState(setUpdate);
  }, []);

  async function checkForUpdates() {
    setBusy(true);
    setError("");
    try {
      await window.noteAPI.checkUpdate();
      await window.noteAPI.openUpdateWindow();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法检查更新");
    } finally {
      setBusy(false);
    }
  }

  async function setAutoCheck(checked: boolean) {
    setBusy(true);
    setError("");
    try {
      onSettings(await window.noteAPI.updateGeneralSettings({ updateAutoCheck: checked }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存设置");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section-body">
      <header className="settings-section-heading">
        <h1>关于</h1>
        <p>Pinote 桌面便签</p>
      </header>

      <section className="settings-group about-product" aria-labelledby="about-product-heading">
        <div className="about-product-mark" aria-hidden="true">P</div>
        <div>
          <h2 id="about-product-heading">{info.name}</h2>
          <p>版本 {displayVersion(info.version)}</p>
          {info.fakeBuild && <p className="settings-paragraph">这是用于验证更新流程的测试构建.</p>}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="about-update-heading">
        <h2 id="about-update-heading">更新</h2>
        {error && <div className="settings-inline-error" role="alert">{error}</div>}
        {update && (
          <p className="settings-paragraph">
            <strong>{statusHeadline(update)}</strong>
            {statusDetail(update) ? ` ${statusDetail(update)}` : ""}
          </p>
        )}
        <label className="settings-toggle-row">
          <span className="settings-field-copy">
            <strong>启动时自动检查更新</strong>
            <span>启动 5 秒后静默检查一次, 不打断当前操作</span>
          </span>
          <input
            className="settings-switch-input"
            type="checkbox"
            checked={settings.updateAutoCheck}
            disabled={busy}
            onChange={(event) => void setAutoCheck(event.target.checked)}
          />
        </label>
        <div className="settings-field-row">
          <div className="settings-field-copy">
            <strong>手动检查</strong>
            <span>检查失败时只在日志里记录原因</span>
          </div>
          <button className="settings-text-command" type="button" disabled={busy} onClick={() => void checkForUpdates()}>
            检查更新
          </button>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="about-runtime-heading">
        <h2 id="about-runtime-heading">运行环境</h2>
        <dl className="about-details">
          <div><dt>Electron</dt><dd>{info.electronVersion}</dd></div>
          <div><dt>系统</dt><dd>{info.platform}</dd></div>
          <div><dt>架构</dt><dd>{info.arch}</dd></div>
          <div><dt>构建</dt><dd>{info.devBuild ? "开发构建" : "发布构建"}</dd></div>
        </dl>
      </section>

      <section className="settings-group" aria-labelledby="about-data-heading">
        <h2 id="about-data-heading">数据</h2>
        <p className="settings-paragraph">便签优先保存在当前设备. 只有启用云同步后, 便签内容才会发送到配置的同步服务.</p>
        <dl className="about-details">
          <div><dt>日志</dt><dd className="about-path">{info.logFile}</dd></div>
        </dl>
      </section>
    </div>
  );
}

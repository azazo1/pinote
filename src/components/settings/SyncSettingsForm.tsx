import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyncStatus } from "../../types";

interface SyncSettingsFormProps {
  status: SyncStatus;
  onStatus: (status: SyncStatus) => void;
  compact?: boolean;
}

export function SyncSettingsForm({ status, onStatus, compact = false }: SyncSettingsFormProps) {
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [tokenPersistent, setTokenPersistent] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.noteAPI.getSyncSettings().then((settings) => {
      setUrl(settings.url);
      setSavedUrl(settings.url);
      setConfigured(settings.configured);
      setTokenPersistent(settings.tokenPersistent);
    });
  }, []);

  const connectionChanged = url.trim() !== savedUrl || Boolean(token.trim());

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (configured && !connectionChanged) {
        onStatus(await window.noteAPI.syncNow());
      } else {
        onStatus({ state: "syncing", message: "正在连接" });
        const settings = await window.noteAPI.configureSync({ url, token });
        setConfigured(settings.configured);
        setTokenPersistent(settings.tokenPersistent);
        setSavedUrl(settings.url);
        setUrl(settings.url);
        setToken("");
      }
    } catch (error) {
      onStatus({ state: "error", message: errorMessage(error, "连接失败") });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await window.noteAPI.configureSync({ url: "", token: "" });
      setConfigured(false);
      setTokenPersistent(true);
      setSavedUrl("");
      setUrl("");
      setToken("");
    } catch (error) {
      onStatus({ state: "error", message: errorMessage(error, "断开失败") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`sync-settings-form${compact ? " is-compact" : ""}`}>
      <label className="sync-settings-field">
        <span>服务地址</span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://notes.example.com"
          spellCheck={false}
        />
      </label>
      <label className="sync-settings-field">
        <span>访问令牌</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={configured ? "已安全保存" : "必填"}
        />
      </label>
      <div className={`sync-state is-${status.state}`} aria-live="polite">{status.message}</div>
      {configured && !tokenPersistent && <div className="sync-storage-warning">令牌将在退出时清除</div>}
      <div className="sync-settings-actions">
        {configured && (
          <button className="sync-secondary-command" type="button" disabled={busy} onClick={() => void disconnect()}>
            <CloudOff size={15} />
            {!compact && <span>断开同步</span>}
          </button>
        )}
        <button
          className="command-button"
          type="button"
          disabled={!url.trim() || busy || status.state === "syncing"}
          onClick={() => void submit()}
        >
          <RefreshCw size={15} className={busy || status.state === "syncing" ? "is-spinning" : ""} />
          {configured ? connectionChanged ? "更新并同步" : "立即同步" : "连接"}
        </button>
      </div>
    </div>
  );
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : fallback;
}

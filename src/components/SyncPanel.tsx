import { CloudOff, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyncStatus } from "../types";
import { IconButton } from "./IconButton";

interface SyncPanelProps {
  status: SyncStatus;
  onClose: () => void;
  onStatus: (status: SyncStatus) => void;
}

export function SyncPanel({ status, onClose, onStatus }: SyncPanelProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [tokenPersistent, setTokenPersistent] = useState(true);

  useEffect(() => {
    void window.noteAPI.getSyncSettings().then((settings) => {
      setUrl(settings.url);
      setConfigured(settings.configured);
      setTokenPersistent(settings.tokenPersistent);
    });
  }, []);

  async function save() {
    try {
      onStatus({ state: "syncing", message: "正在连接" });
      const settings = await window.noteAPI.configureSync({ url, token });
      setConfigured(settings.configured);
      setTokenPersistent(settings.tokenPersistent);
      setToken("");
    } catch (error) {
      onStatus({ state: "error", message: error instanceof Error ? error.message : "连接失败" });
    }
  }

  async function disconnect() {
    await window.noteAPI.configureSync({ url: "", token: "" });
    setConfigured(false);
    setTokenPersistent(true);
    setUrl("");
    setToken("");
  }

  return (
    <section className="sync-panel" aria-label="同步设置">
      <div className="sync-panel-heading">
        <strong>同步</strong>
        <IconButton icon={X} label="关闭" onClick={onClose} />
      </div>
      <label>
        <span>服务地址</span>
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://notes.example.com" />
      </label>
      <label>
        <span>访问令牌</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={configured ? "已安全保存" : "必填"}
        />
      </label>
      <div className={`sync-state is-${status.state}`}>{status.message}</div>
      {configured && !tokenPersistent && <div className="sync-storage-warning">令牌将在退出时清除</div>}
      <div className="sync-panel-actions">
        {configured && <IconButton icon={CloudOff} label="断开同步" onClick={() => void disconnect()} />}
        <button className="command-button" type="button" disabled={!url || status.state === "syncing"} onClick={() => void save()}>
          <RefreshCw size={16} className={status.state === "syncing" ? "is-spinning" : ""} />
          {configured ? "立即同步" : "连接"}
        </button>
      </div>
    </section>
  );
}

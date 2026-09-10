import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { displayVersion, isHandoffState, progressPercent, statusDetail, statusHeadline } from "../lib/update-status";
import type { UpdateSnapshot } from "../types";

const noteAPI = window.noteAPI;

export default function UpdateApp() {
  const [state, setState] = useState<UpdateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    void noteAPI.getUpdateState().then(setState);
    return noteAPI.onUpdateState(setState);
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "操作失败, 请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <main className="update-shell"><div className="update-loading">正在读取更新状态</div></main>;
  }

  const percent = progressPercent(state);
  const handoff = isHandoffState(state);
  const downloading = state.state === "downloading";
  const canUpdate = state.state === "available";
  const canRestart = state.state === "ready-to-restart";

  return (
    <main className="update-shell">
      <header className="update-header">
        <div>
          <h1>Pinote 更新</h1>
          <p className="update-current">当前版本 <strong>{displayVersion(state.currentVersion)}</strong></p>
        </div>
        <button
          className="update-icon-button"
          type="button"
          aria-label="重新检查更新"
          title="重新检查更新"
          disabled={busy || downloading || handoff}
          onClick={() => void run(() => noteAPI.checkUpdate())}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {state.applyResult && (
        <div className="update-notice" role="alert">
          <strong>上次更新没有完成</strong>
          <p>{state.applyResult}</p>
          <button type="button" onClick={() => void run(() => noteAPI.dismissUpdateApplyResult())}>知道了</button>
        </div>
      )}

      <section className={`update-status is-${state.state}`} aria-live="polite">
        <strong className="update-status-headline">{statusHeadline(state)}</strong>
        <p className="update-status-detail">{statusDetail(state)}</p>
        {downloading && (
          <div className="update-progress">
            <div
              className="update-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <span style={{ width: `${percent ?? 15}%` }} />
            </div>
            <span className="update-progress-caption">{percent === null ? "正在下载" : `${percent}%`}</span>
          </div>
        )}
        {handoff && (
          <div className="update-progress" aria-hidden="true">
            <div className="update-progress-bar is-indeterminate">
              <span />
            </div>
          </div>
        )}
      </section>

      {state.error && !handoff && (
        <div className="update-error" role="alert">{state.error.message}</div>
      )}

      {actionError && <div className="update-error" role="alert">{actionError}</div>}

      {state.releaseNotes && (
        <section className="update-notes" aria-label="更新说明">
          <h2>{state.releaseName || `${displayVersion(state.latestVersion)} 更新内容`}</h2>
          <div className="update-notes-body">{state.releaseNotes}</div>
        </section>
      )}

      {!handoff && (
        <footer className="update-actions">
          <label className="update-auto-check">
            <input
              type="checkbox"
              checked={state.autoCheck}
              disabled={busy || downloading}
              onChange={(event) => void run(() => noteAPI.updateGeneralSettings({ updateAutoCheck: event.target.checked }))}
            />
            启动时自动检查更新
          </label>
          {canUpdate && (
            <button className="update-primary" type="button" disabled={busy} onClick={() => void run(() => noteAPI.downloadUpdate())}>
              立即更新
            </button>
          )}
          {downloading && (
            <button type="button" disabled={busy} onClick={() => void run(() => noteAPI.cancelUpdate())}>取消更新</button>
          )}
          {canRestart && (
            <button className="update-primary" type="button" disabled={busy} onClick={() => void run(() => noteAPI.restartToApplyUpdate())}>
              重启应用
            </button>
          )}
          {canUpdate && (
            <button type="button" disabled={busy} onClick={() => void run(() => noteAPI.skipUpdateVersion())}>
              跳过此版本
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void run(() => noteAPI.openUpdateReleasePage())}>
            查看 Release 页
          </button>
        </footer>
      )}
    </main>
  );
}

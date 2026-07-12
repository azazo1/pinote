import { Cloud, Plus, Search, StickyNote, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MainNoteList } from "./components/MainNoteList";
import { SyncPanel } from "./components/SyncPanel";
import type { NoteSummary, SyncStatus } from "./types";

const noteAPI = window.noteAPI;

export default function MainApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle", message: "同步未启用" });
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    void noteAPI.listNotes().then(setNotes);
    void noteAPI.getSyncStatus().then(setSyncStatus);
    const offList = noteAPI.onNoteList(setNotes);
    const offSync = noteAPI.onSyncStatus(setSyncStatus);
    return () => {
      offList();
      offSync();
    };
  }, []);

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => !normalized
        || note.title.toLocaleLowerCase().includes(normalized)
        || note.markdown.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
        || right.modifiedAt - left.modifiedAt);
  }, [notes, query]);

  async function createNote() {
    if (creating) return;
    setCreating(true);
    setActionError("");
    try {
      const note = await noteAPI.createNote();
      await noteAPI.openNote(note.id);
    } catch {
      setActionError("无法新建便签, 请稍后重试");
    } finally {
      setCreating(false);
    }
  }

  async function openNote(id: string) {
    setActionError("");
    try {
      await noteAPI.openNote(id);
    } catch {
      setActionError("无法打开便签, 请稍后重试");
    }
  }

  async function deleteNote(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setActionError("");
    try {
      await noteAPI.deleteNote(id);
    } catch {
      setActionError("无法删除便签, 请稍后重试");
    } finally {
      setDeletingId(null);
    }
  }

  const noMatches = notes.length > 0 && visibleNotes.length === 0;

  return (
    <main className="main-shell">
      <header className="main-header">
        <div className="main-brand">
          <span className="main-brand-mark" aria-hidden="true"><StickyNote size={18} /></span>
          <strong>Pinote</strong>
          <span>{notes.length}</span>
        </div>
        <div className="main-header-actions">
          <button
            className={`main-icon-button sync-${syncStatus.state}`}
            type="button"
            aria-label="同步设置"
            title={syncStatus.message}
            onClick={() => setSyncOpen((open) => !open)}
          >
            <Cloud size={17} />
            <span className="main-sync-dot" aria-hidden="true" />
          </button>
          <button className="main-create-button" type="button" disabled={creating} onClick={() => void createNote()}>
            <Plus size={16} />
            <span>新建便签</span>
          </button>
        </div>
      </header>

      <section className="main-toolbar" aria-label="便签工具栏">
        <label className="main-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="搜索标题或内容"
            aria-label="搜索便签"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <button type="button" aria-label="清除搜索" title="清除搜索" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <span className="main-result-count" aria-live="polite">
          {query ? `${visibleNotes.length} 个结果` : `${notes.length} 张便签`}
        </span>
      </section>

      {syncOpen && <SyncPanel status={syncStatus} onClose={() => setSyncOpen(false)} onStatus={setSyncStatus} />}

      {actionError && <div className="main-action-error" role="alert">{actionError}</div>}

      <section className="main-content" aria-label="全部便签">
        {visibleNotes.length > 0 ? (
          <MainNoteList
            notes={visibleNotes}
            deletingId={deletingId}
            onOpen={(id) => void openNote(id)}
            onDelete={(id) => void deleteNote(id)}
          />
        ) : (
          <div className="main-empty">
            <StickyNote size={28} strokeWidth={1.5} aria-hidden="true" />
            <strong>{noMatches ? "没有匹配的便签" : "还没有便签"}</strong>
            {noMatches ? (
              <button type="button" className="main-empty-command" onClick={() => setQuery("")}>清除搜索</button>
            ) : (
              <button type="button" className="main-empty-command" onClick={() => void createNote()}>新建便签</button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

import { ArrowLeft, Cloud, Folder, Hash, Plus, Power, Search, Settings, StickyNote, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MainNoteList } from "./components/MainNoteList";
import { SettingsCenter, type SettingsSection } from "./components/settings/SettingsCenter";
import type { NoteSummary, SyncStatus } from "./types";

const noteAPI = window.noteAPI;

export default function MainApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<"notes" | "settings">("notes");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle", message: "同步未启用" });
  const [creating, setCreating] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => noteAPI.onCommand((command) => {
    if (command === "focus-search") {
      setActiveView("notes");
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    } else if (command === "open-settings") {
      setSettingsSection("general");
      setActiveView("settings");
    }
  }), []);

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const name = note.groupName.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [notes]);

  const tagOptions = useMemo(() => {
    const labels = new Map<string, { label: string; count: number }>();
    for (const note of notes) {
      const noteTags = new Map<string, string>();
      for (const rawTag of note.tags) {
        const label = rawTag.trim();
        if (label) noteTags.set(label.toLowerCase(), label);
      }
      for (const [key, label] of noteTags) {
        const current = labels.get(key);
        labels.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
      }
    }
    return [...labels.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }, [notes]);

  useEffect(() => {
    if (groupFilter !== null && groupFilter !== "" && !groupOptions.some((group) => group.name === groupFilter)) {
      setGroupFilter(null);
    }
  }, [groupFilter, groupOptions]);

  useEffect(() => {
    const availableTags = new Set(tagOptions.map((tag) => tag.key));
    setTagFilters((current) => {
      const next = current.filter((tag) => availableTags.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [tagOptions]);

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return notes
      .filter((note) => {
        const groupName = note.groupName.trim();
        if (groupFilter !== null && groupName !== groupFilter) return false;

        const noteTags = note.tags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .map((tag) => tag.toLowerCase());
        const noteTagSet = new Set(noteTags);
        if (tagFilters.some((tag) => !noteTagSet.has(tag))) return false;

        return !normalized
          || note.title.toLowerCase().includes(normalized)
          || note.markdown.toLowerCase().includes(normalized)
          || groupName.toLowerCase().includes(normalized)
          || noteTags.some((tag) => tag.includes(normalized) || `#${tag}`.includes(normalized));
      })
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
        || right.modifiedAt - left.modifiedAt);
  }, [groupFilter, notes, query, tagFilters]);

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

  async function requestQuit() {
    if (quitting) return;
    setQuitting(true);
    setActionError("");
    try {
      await noteAPI.requestQuit();
    } catch {
      setActionError("无法退出应用, 请稍后重试");
    } finally {
      setQuitting(false);
    }
  }

  const ungroupedCount = notes.filter((note) => !note.groupName.trim()).length;
  const hasActiveFilters = Boolean(query.trim()) || groupFilter !== null || tagFilters.length > 0;
  const noMatches = notes.length > 0 && visibleNotes.length === 0;

  function toggleTag(tag: string) {
    setTagFilters((current) => current.includes(tag)
      ? current.filter((value) => value !== tag)
      : [...current, tag]);
  }

  function clearFilters() {
    setQuery("");
    setGroupFilter(null);
    setTagFilters([]);
  }

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setActiveView("settings");
  }

  return (
    <main className={`main-shell${activeView === "settings" ? " is-settings" : ""}`}>
      <header className="main-header">
        <div className="main-brand">
          <span className="main-brand-mark" aria-hidden="true"><StickyNote size={18} /></span>
          <strong>Pinote</strong>
          <span>{notes.length}</span>
        </div>
        <div className="main-header-actions">
          <button
            className="main-icon-button main-quit-button"
            type="button"
            aria-label="退出 Pinote"
            title="退出 Pinote"
            disabled={quitting}
            onClick={() => void requestQuit()}
          >
            <Power size={17} />
          </button>
          <button
            className={`main-icon-button sync-${syncStatus.state}`}
            type="button"
            aria-label="云同步设置"
            title={syncStatus.message}
            onClick={() => openSettings("sync")}
          >
            <Cloud size={17} />
            <span className="main-sync-dot" aria-hidden="true" />
          </button>
          <button
            className={`main-icon-button${activeView === "settings" ? " is-active" : ""}`}
            type="button"
            aria-label={activeView === "settings" ? "返回便签" : "打开设置"}
            title={activeView === "settings" ? "返回便签" : "设置"}
            aria-pressed={activeView === "settings"}
            onClick={() => activeView === "settings" ? setActiveView("notes") : openSettings("general")}
          >
            {activeView === "settings" ? <ArrowLeft size={17} /> : <Settings size={17} />}
          </button>
          <button className="main-create-button" type="button" disabled={creating} onClick={() => void createNote()}>
            <Plus size={16} />
            <span>新建便签</span>
          </button>
        </div>
      </header>

      {activeView === "notes" ? <>
      <section className="main-toolbar" aria-label="便签工具栏">
        <div className="main-toolbar-primary">
          <label className="main-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder="搜索标题, 内容, 分组或标签"
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
            {hasActiveFilters ? `${visibleNotes.length} 个结果` : `${notes.length} 张便签`}
          </span>
        </div>

        <div className="main-filter-row" aria-label="按分组筛选">
          <span className="main-filter-kind" title="分组"><Folder size={13} aria-hidden="true" /></span>
          <div className="main-filter-scroll" role="group" aria-label="便签分组">
            <button
              className="main-group-filter"
              type="button"
              aria-pressed={groupFilter === null}
              onClick={() => setGroupFilter(null)}
            >
              全部 <span>{notes.length}</span>
            </button>
            <button
              className="main-group-filter"
              type="button"
              aria-pressed={groupFilter === ""}
              onClick={() => setGroupFilter("")}
            >
              未分组 <span>{ungroupedCount}</span>
            </button>
            {groupOptions.map((group) => (
              <button
                className="main-group-filter"
                type="button"
                key={group.name}
                aria-pressed={groupFilter === group.name}
                onClick={() => setGroupFilter(group.name)}
              >
                {group.name} <span>{group.count}</span>
              </button>
            ))}
          </div>
        </div>

        {tagOptions.length > 0 && (
          <div className="main-filter-row" aria-label="按标签筛选">
            <span className="main-filter-kind" title="标签"><Hash size={13} aria-hidden="true" /></span>
            <div className="main-filter-scroll" role="group" aria-label="便签标签">
              {tagOptions.map((tag) => (
                <button
                  className="main-tag-filter"
                  type="button"
                  key={tag.key}
                  aria-pressed={tagFilters.includes(tag.key)}
                  onClick={() => toggleTag(tag.key)}
                >
                  {tag.label} <span>{tag.count}</span>
                </button>
              ))}
            </div>
            {tagFilters.length > 0 && (
              <button className="main-filter-clear" type="button" onClick={() => setTagFilters([])}>清除</button>
            )}
          </div>
        )}
      </section>

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
              <button type="button" className="main-empty-command" onClick={clearFilters}>清除筛选</button>
            ) : (
              <button type="button" className="main-empty-command" onClick={() => void createNote()}>新建便签</button>
            )}
          </div>
        )}
      </section>
      </> : (
        <SettingsCenter
          section={settingsSection}
          status={syncStatus}
          onSection={setSettingsSection}
          onStatus={setSyncStatus}
        />
      )}
    </main>
  );
}

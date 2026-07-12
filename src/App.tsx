import { Cloud, PanelRightClose, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, noteColors } from "./components/ColorPicker";
import { IconButton } from "./components/IconButton";
import { InlineShelf } from "./components/InlineShelf";
import { NoteEditor } from "./components/NoteEditor";
import { SyncPanel } from "./components/SyncPanel";
import { TitleBar } from "./components/TitleBar";
import { dateLabel } from "./lib/date-label";
import type { GroupState, Note, PlatformCapabilities, SyncStatus } from "./types";

export default function App() {
  const noteId = useMemo(() => new URLSearchParams(window.location.search).get("noteId") ?? "", []);
  const [note, setNote] = useState<Note | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [group, setGroup] = useState<GroupState>({ docked: false, mode: "shelf" });
  const [capabilities, setCapabilities] = useState<PlatformCapabilities>({ platform: "darwin", wayland: false });
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle", message: "同步未启用" });
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Pick<Partial<Note>, "title" | "markdown" | "color">>({});

  const applyContentPatch = useCallback((patch: Pick<Partial<Note>, "title" | "markdown" | "color">) => {
    setNote((current) => current ? { ...current, ...patch, modifiedAt: Date.now(), dirty: true } : current);
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const nextPatch = pendingPatch.current;
      pendingPatch.current = {};
      void window.noteAPI.updateNote(noteId, nextPatch);
    }, 280);
  }, [noteId]);

  const toggleCollapse = useCallback(() => {
    void window.noteAPI.toggleCollapse(noteId);
  }, [noteId]);

  useEffect(() => {
    void window.noteAPI.getNote(noteId).then((result) => {
      setNote(result.note);
      setGroup(result.group);
      setCapabilities(result.capabilities);
    });
    void window.noteAPI.getSyncStatus().then(setSyncStatus);
    const offCollapsed = window.noteAPI.onCollapsed((collapsed) => setNote((current) => current ? { ...current, collapsed } : current));
    const offGroup = window.noteAPI.onGroupState(setGroup);
    const offCommand = window.noteAPI.onCommand((command) => {
      if (command === "toggle-collapse") toggleCollapse();
    });
    const offRemote = window.noteAPI.onRemoteNote((remote) => {
      setNote({ ...remote, ...pendingPatch.current });
    });
    const offSync = window.noteAPI.onSyncStatus(setSyncStatus);
    return () => {
      offCollapsed();
      offGroup();
      offCommand();
      offRemote();
      offSync();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (Object.keys(pendingPatch.current).length > 0) void window.noteAPI.updateNote(noteId, pendingPatch.current);
    };
  }, [noteId, toggleCollapse]);

  if (!note) return <main className="loading-note" aria-label="正在加载" />;

  const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
  const style = {
    "--note-body": palette.body,
    "--note-bar": palette.bar,
    "--note-ink": palette.ink,
  } as React.CSSProperties;
  const inlineShelf = group.docked && group.mode === "inline";

  return (
    <main
      className={`note-shell${note.collapsed ? " is-collapsed" : ""}${inlineShelf ? " has-inline-shelf" : ""}`}
      style={style}
      onMouseEnter={() => window.noteAPI.revealGroup()}
      onMouseLeave={() => window.noteAPI.hideGroup()}
    >
      <TitleBar
        noteId={note.id}
        title={note.title}
        pinned={note.pinned}
        colorPickerOpen={pickerOpen}
        onToggleColorPicker={() => setPickerOpen((open) => !open)}
        onTogglePinned={() => {
          const pinned = !note.pinned;
          setNote((current) => current ? { ...current, pinned } : current);
          void window.noteAPI.setPinned(note.id, pinned);
        }}
        onDelete={() => void window.noteAPI.deleteNote(note.id)}
        onCollapse={toggleCollapse}
        nativeDrag={capabilities.wayland}
      />

      {pickerOpen && (
        <ColorPicker
          value={note.color}
          onChange={(color) => {
            applyContentPatch({ color });
            setPickerOpen(false);
          }}
        />
      )}

      {syncOpen && <SyncPanel status={syncStatus} onClose={() => setSyncOpen(false)} onStatus={setSyncStatus} />}

      <section className="note-content">
        <input
          className="title-input"
          value={note.title}
          onChange={(event) => applyContentPatch({ title: event.target.value })}
          placeholder="标题"
          aria-label="标题"
        />
        <NoteEditor content={note.markdown} onChange={(markdown) => applyContentPatch({ markdown })} />
      </section>

      {inlineShelf && <InlineShelf activeId={note.id} />}

      <footer className="note-footer">
        <time dateTime={new Date(note.modifiedAt).toISOString()}>{dateLabel(note.modifiedAt)}</time>
        <div className="footer-actions">
          <IconButton icon={Plus} label="新建便签" onClick={() => void window.noteAPI.createNote()} />
          <IconButton icon={Cloud} label="同步设置" active={syncOpen || syncStatus.state === "syncing"} onClick={() => setSyncOpen((open) => !open)} />
          <IconButton
            icon={PanelRightClose}
            label="侧边吸附便签组"
            active={group.docked}
            onClick={() => void window.noteAPI.toggleGroupDock().then(setGroup)}
          />
        </div>
      </footer>
    </main>
  );
}

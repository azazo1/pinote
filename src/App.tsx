import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, noteColors } from "./components/ColorPicker";
import { InlineShelf } from "./components/InlineShelf";
import { NoteEditor } from "./components/NoteEditor";
import { NoteMenu } from "./components/NoteMenu";
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

  const flushPendingPatch = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const nextPatch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(nextPatch).length > 0) await window.noteAPI.updateNote(noteId, nextPatch);
  }, [noteId]);

  const applyContentPatch = useCallback((patch: Pick<Partial<Note>, "title" | "markdown" | "color">) => {
    setNote((current) => current ? { ...current, ...patch, modifiedAt: Date.now(), dirty: true } : current);
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void flushPendingPatch();
    }, 280);
  }, [flushPendingPatch]);

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
      void flushPendingPatch();
    };
  }, [flushPendingPatch, noteId, toggleCollapse]);

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
        onClose={() => {
          void flushPendingPatch().finally(() => {
            void window.noteAPI.closeNote(note.id);
          });
        }}
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
          <NoteMenu
            docked={group.docked}
            onCreate={() => void window.noteAPI.createNote()}
            onToggleDock={() => void window.noteAPI.toggleGroupDock().then(setGroup)}
            onOpenMainWindow={() => void window.noteAPI.openMainWindow()}
            onOpenSync={() => setSyncOpen(true)}
            onDelete={() => void window.noteAPI.deleteNote(note.id)}
          />
        </div>
      </footer>
    </main>
  );
}

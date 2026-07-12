import { Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorPicker, noteColors } from "./components/ColorPicker";
import { IconButton } from "./components/IconButton";
import { InlineShelf } from "./components/InlineShelf";
import { NoteEditor } from "./components/NoteEditor";
import { NoteMetadataPanel } from "./components/NoteMetadataPanel";
import { NoteMenu } from "./components/NoteMenu";
import { SyncPanel } from "./components/SyncPanel";
import { TitleBar } from "./components/TitleBar";
import { dateLabel } from "./lib/date-label";
import { combineTagSources, extractInlineTags, normalizeTags, reconcileInlineTags } from "./lib/note-metadata";
import type { Note, PlatformCapabilities, SyncStatus } from "./types";

type ContentPatch = Pick<Partial<Note>, "title" | "markdown" | "color" | "groupName" | "tags">;

interface PendingBatch {
  patch: ContentPatch;
  baseRevision: number;
}

const SAVE_RETRY_DELAYS_MS = [500, 2_000, 5_000];

export default function App() {
  const noteId = useMemo(() => new URLSearchParams(window.location.search).get("noteId") ?? "", []);
  const [note, setNote] = useState<Note | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [inlineTags, setInlineTags] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities>({ platform: "darwin", wayland: false });
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle", message: "同步未启用" });
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<ContentPatch>({});
  const pendingBaseRevision = useRef<number | null>(null);
  const inFlightBatches = useRef<PendingBatch[]>([]);
  const inFlightSaves = useRef<Set<Promise<void>>>(new Set());
  const saveRetryIndex = useRef(0);
  const contentRevision = useRef(0);
  const manualTags = useRef<string[]>([]);
  const inlineTagsRef = useRef<string[]>([]);

  const setCurrentInlineTags = useCallback((tags: string[]) => {
    if (equalTags(inlineTagsRef.current, tags)) return;
    inlineTagsRef.current = tags;
    setInlineTags(tags);
  }, []);

  const flushPendingPatch = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const nextPatch = pendingPatch.current;
    const baseRevision = pendingBaseRevision.current
      ?? currentBranchBase(inFlightBatches.current, null)
      ?? contentRevision.current;
    const activeSaves = [...inFlightSaves.current];
    pendingPatch.current = {};
    pendingBaseRevision.current = null;
    if (Object.keys(nextPatch).length === 0) {
      await waitForSaves(activeSaves);
      return;
    }

    const batch = { patch: nextPatch, baseRevision };
    inFlightBatches.current.push(batch);
    contentRevision.current = Math.min(contentRevision.current, baseRevision);
    const save = (async () => {
      let updated: Note | null = null;
      try {
        updated = await window.noteAPI.updateNote(noteId, nextPatch, baseRevision);
      } catch (error) {
        const batchIndex = inFlightBatches.current.indexOf(batch);
        const laterBatches = batchIndex >= 0 ? inFlightBatches.current.slice(batchIndex + 1) : [];
        pendingPatch.current = {
          ...nextPatch,
          ...mergePendingPatches(laterBatches, pendingPatch.current),
        };
        pendingBaseRevision.current = pendingBaseRevision.current === null
          ? baseRevision
          : Math.min(baseRevision, pendingBaseRevision.current);
        if (saveTimer.current === null && saveRetryIndex.current < SAVE_RETRY_DELAYS_MS.length) {
          const delay = SAVE_RETRY_DELAYS_MS[saveRetryIndex.current];
          saveRetryIndex.current += 1;
          saveTimer.current = window.setTimeout(() => {
            saveTimer.current = null;
            void flushPendingPatch().catch(() => {});
          }, delay);
        }
        throw error;
      } finally {
        const index = inFlightBatches.current.indexOf(batch);
        if (index >= 0) inFlightBatches.current.splice(index, 1);
      }
      if (!updated) return;
      saveRetryIndex.current = 0;
      const remainingBase = currentBranchBase(inFlightBatches.current, pendingBaseRevision.current);
      contentRevision.current = remainingBase ?? updated.revision;
      setNote((current) => current ? {
        ...current,
        revision: contentRevision.current,
        modifiedBy: updated.modifiedBy,
        dirty: remainingBase !== null || updated.dirty,
      } : current);
    })();
    inFlightSaves.current.add(save);
    try {
      await waitForSaves([...activeSaves, save]);
    } finally {
      inFlightSaves.current.delete(save);
    }
  }, [noteId]);

  const queueContentPatch = useCallback((patch: ContentPatch) => {
    saveRetryIndex.current = 0;
    if (pendingBaseRevision.current === null) {
      pendingBaseRevision.current = currentBranchBase(inFlightBatches.current, null) ?? contentRevision.current;
    }
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void flushPendingPatch();
    }, 280);
  }, [flushPendingPatch]);

  const applyContentPatch = useCallback((patch: ContentPatch) => {
    setNote((current) => current ? { ...current, ...patch, modifiedAt: Date.now(), dirty: true } : current);
    queueContentPatch(patch);
  }, [queueContentPatch]);

  const applyMarkdownPatch = useCallback((markdown: string) => {
    const reconciled = combineTagSources(manualTags.current, extractInlineTags(markdown));
    setCurrentInlineTags(reconciled.inlineTags);
    applyContentPatch({ markdown, tags: reconciled.tags });
  }, [applyContentPatch, setCurrentInlineTags]);

  const applyMetadataPatch = useCallback((patch: { groupName?: string; tags?: string[] }) => {
    if (!patch.tags) {
      applyContentPatch(patch);
      return;
    }
    const inlineCandidates = extractInlineTags(note?.markdown ?? "");
    const inlineKeys = new Set(inlineCandidates.map((tag) => tag.toLowerCase()));
    manualTags.current = normalizeTags(patch.tags.filter((tag) => !inlineKeys.has(tag.toLowerCase())));
    const reconciled = combineTagSources(manualTags.current, inlineCandidates);
    setCurrentInlineTags(reconciled.inlineTags);
    applyContentPatch({
      ...patch,
      tags: reconciled.tags,
    });
  }, [applyContentPatch, note?.markdown, setCurrentInlineTags]);

  const toggleCollapse = useCallback(() => {
    void window.noteAPI.toggleCollapse(noteId);
  }, [noteId]);

  const toggleDock = useCallback(() => {
    void window.noteAPI.toggleNoteDock(noteId).then((result) => {
      const localPatch = mergePendingPatches(inFlightBatches.current, pendingPatch.current);
      const baseRevision = currentBranchBase(inFlightBatches.current, pendingBaseRevision.current);
      if (!result.note) {
        setNote(null);
        return;
      }
      const dockedNote = result.note;
      contentRevision.current = baseRevision ?? dockedNote.revision;
      setNote((current) => ({
        ...dockedNote,
        ...localPatch,
        revision: contentRevision.current,
        modifiedAt: baseRevision !== null ? current?.modifiedAt ?? dockedNote.modifiedAt : dockedNote.modifiedAt,
        dirty: baseRevision !== null || dockedNote.dirty,
      }));
    });
  }, [noteId]);

  useEffect(() => {
    void window.noteAPI.getNote(noteId).then((result) => {
      const loaded = result.note;
      if (loaded) {
        contentRevision.current = loaded.revision;
        const loadedInlineTags = extractInlineTags(loaded.markdown);
        const reconciled = reconcileInlineTags(loaded.tags, loadedInlineTags, loaded.markdown);
        manualTags.current = reconciled.manualTags;
        setCurrentInlineTags(reconciled.inlineTags);
        setNote({ ...loaded, tags: reconciled.tags });
        if (!equalTags(reconciled.tags, loaded.tags)) {
          void window.noteAPI.updateNote(noteId, { tags: reconciled.tags }, loaded.revision);
        }
      } else {
        setNote(null);
      }
      setCapabilities(result.capabilities);
    });
    void window.noteAPI.getSyncStatus().then(setSyncStatus);
    const offCollapsed = window.noteAPI.onCollapsed((collapsed) => setNote((current) => current ? { ...current, collapsed } : current));
    const offGroup = window.noteAPI.onGroupState((state) => {
      setNote((current) => current ? {
        ...current,
        dockState: state.dockedIds.includes(current.id) ? state.mode : "free",
      } : current);
    });
    const offCommand = window.noteAPI.onCommand((command) => {
      if (command === "toggle-collapse") toggleCollapse();
      if (command === "toggle-dock") toggleDock();
    });
    const offRemote = window.noteAPI.onRemoteNote((remote) => {
      const localPatch = mergePendingPatches(inFlightBatches.current, pendingPatch.current);
      const baseRevision = currentBranchBase(inFlightBatches.current, pendingBaseRevision.current);
      contentRevision.current = baseRevision ?? remote.revision;
      const merged = { ...remote, ...localPatch, revision: contentRevision.current };
      const sourceInlineTags = localPatch.tags
        ? typeof localPatch.markdown === "string" ? extractInlineTags(localPatch.markdown) : inlineTagsRef.current
        : extractInlineTags(remote.markdown);
      const reconciled = reconcileInlineTags(merged.tags, sourceInlineTags, merged.markdown);
      const tagsChanged = !equalTags(reconciled.tags, merged.tags);
      manualTags.current = reconciled.manualTags;
      setCurrentInlineTags(reconciled.inlineTags);
      if (tagsChanged) queueContentPatch({ tags: reconciled.tags });
      setNote((current) => ({
        ...merged,
        tags: reconciled.tags,
        modifiedAt: baseRevision !== null ? current?.modifiedAt ?? Date.now() : tagsChanged ? Date.now() : merged.modifiedAt,
        dirty: baseRevision !== null || tagsChanged || merged.dirty,
      }));
    });
    const offFlush = window.noteAPI.onFlushRequested(flushPendingPatch);
    const offSync = window.noteAPI.onSyncStatus(setSyncStatus);
    return () => {
      offCollapsed();
      offGroup();
      offCommand();
      offRemote();
      offFlush();
      offSync();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void flushPendingPatch();
    };
  }, [flushPendingPatch, noteId, queueContentPatch, setCurrentInlineTags, toggleCollapse, toggleDock]);

  if (!note) return <main className="loading-note" aria-label="正在加载" />;

  const palette = noteColors[note.color as keyof typeof noteColors] ?? noteColors.lemon;
  const style = {
    "--note-body": palette.body,
    "--note-bar": palette.bar,
    "--note-ink": palette.ink,
  } as React.CSSProperties;
  const docked = note.dockState !== "free";
  const inlineShelf = note.dockState === "inline";

  return (
    <main
      className={`note-shell${note.collapsed ? " is-collapsed" : ""}${inlineShelf ? " has-inline-shelf" : ""}`}
      style={style}
      onMouseEnter={docked ? () => window.noteAPI.revealGroup() : undefined}
      onMouseLeave={docked ? () => window.noteAPI.hideGroup() : undefined}
    >
      <TitleBar
        noteId={note.id}
        title={note.title}
        pinned={note.pinned}
        colorPickerOpen={pickerOpen}
        onToggleColorPicker={() => {
          setMetadataOpen(false);
          setPickerOpen((open) => !open);
        }}
        onTogglePinned={() => {
          const pinned = !note.pinned;
          setNote((current) => current ? { ...current, pinned } : current);
          void window.noteAPI.setPinned(note.id, pinned);
        }}
        onClose={() => {
          void flushPendingPatch().then(() => {
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

      {metadataOpen && (
        <NoteMetadataPanel
          groupName={note.groupName}
          tags={note.tags}
          inlineTags={inlineTags}
          onChange={applyMetadataPatch}
          onClose={() => setMetadataOpen(false)}
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
        <NoteEditor content={note.markdown} highlightedTags={inlineTags} onChange={applyMarkdownPatch} />
      </section>

      {inlineShelf && <InlineShelf activeId={note.id} />}

      <footer className="note-footer">
        <time dateTime={new Date(note.modifiedAt).toISOString()}>{dateLabel(note.modifiedAt)}</time>
        <div className="footer-actions">
          <IconButton
            icon={Tags}
            label="分组与标签"
            active={metadataOpen}
            onClick={() => {
              setPickerOpen(false);
              setSyncOpen(false);
              setMetadataOpen((open) => !open);
            }}
          />
          <NoteMenu
            docked={docked}
            onCreate={() => void window.noteAPI.createNote()}
            onToggleDock={toggleDock}
            onOpenMainWindow={() => void window.noteAPI.openMainWindow()}
            onOpenSync={() => {
              setMetadataOpen(false);
              setSyncOpen(true);
            }}
            onDelete={() => void window.noteAPI.deleteNote(note.id)}
          />
        </div>
      </footer>
    </main>
  );
}

function equalTags(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function currentBranchBase(batches: readonly PendingBatch[], pendingBase: number | null) {
  return batches[0]?.baseRevision ?? pendingBase;
}

function mergePendingPatches(batches: readonly PendingBatch[], pending: ContentPatch) {
  const merged: ContentPatch = {};
  for (const batch of batches) Object.assign(merged, batch.patch);
  return Object.assign(merged, pending);
}

async function waitForSaves(saves: readonly Promise<void>[]) {
  const results = await Promise.allSettled(saves);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

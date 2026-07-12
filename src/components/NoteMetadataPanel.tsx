import { Folder, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { addTag, MAX_TAGS, normalizeGroupName, normalizeTags } from "../lib/note-metadata";
import type { NoteSummary } from "../types";
import { IconButton } from "./IconButton";

interface NoteMetadataPanelProps {
  groupName: string;
  tags: string[];
  inlineTags: string[];
  onChange: (patch: { groupName?: string; tags?: string[] }) => void;
  onClose: () => void;
}

export function NoteMetadataPanel({ groupName, tags, inlineTags, onChange, onClose }: NoteMetadataPanelProps) {
  const [groupDraft, setGroupDraft] = useState(groupName);
  const [tagDraft, setTagDraft] = useState("");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const groupListId = useId();
  const skipGroupCommit = useRef(false);
  const inlineTagKeys = useMemo(() => new Set(inlineTags.map((tag) => tag.toLowerCase())), [inlineTags]);

  useEffect(() => {
    void window.noteAPI.listNotes().then(setNotes);
  }, []);

  useEffect(() => setGroupDraft(groupName), [groupName]);

  const groupSuggestions = useMemo(() => Array.from(new Set(
    notes.map((note) => note.groupName).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right)), [notes]);
  const tagSuggestions = useMemo(() => {
    const selected = new Set(tags.map((tag) => tag.toLowerCase()));
    const available = new Map<string, string>();
    for (const note of notes) {
      for (const tag of normalizeTags(note.tags)) {
        const key = tag.toLowerCase();
        if (!selected.has(key) && !available.has(key)) available.set(key, tag);
      }
    }
    return [...available.values()]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 8);
  }, [notes, tags]);

  function commitGroup() {
    if (skipGroupCommit.current) {
      skipGroupCommit.current = false;
      return;
    }
    const next = normalizeGroupName(groupDraft);
    setGroupDraft(next);
    if (next !== groupName) onChange({ groupName: next });
  }

  function commitTag(value = tagDraft) {
    const next = addTag(tags, value);
    setTagDraft("");
    if (next.length !== tags.length) onChange({ tags: next });
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTag();
      return;
    }
    if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
      let removableIndex = -1;
      for (let index = tags.length - 1; index >= 0; index -= 1) {
        if (inlineTagKeys.has(tags[index].toLowerCase())) continue;
        removableIndex = index;
        break;
      }
      if (removableIndex >= 0) onChange({ tags: tags.filter((_, index) => index !== removableIndex) });
    }
  }

  return (
    <section className="note-metadata-panel" aria-label="分组与标签">
      <header className="note-metadata-header">
        <strong>整理便签</strong>
        <IconButton icon={X} label="关闭分组与标签" onClick={() => {
          commitGroup();
          onClose();
        }} />
      </header>

      <label className="note-metadata-field">
        <span>分组</span>
        <span className="note-group-input">
          <Folder size={13} aria-hidden="true" />
          <input
            value={groupDraft}
            list={groupListId}
            maxLength={80}
            placeholder="未分组"
            aria-label="便签分组"
            onChange={(event) => setGroupDraft(event.target.value)}
            onBlur={commitGroup}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                skipGroupCommit.current = true;
                setGroupDraft(groupName);
                event.currentTarget.blur();
              }
            }}
          />
        </span>
      </label>
      <datalist id={groupListId}>
        {groupSuggestions.map((group) => <option key={group} value={group} />)}
      </datalist>

      <div className="note-tags-heading">
        <span>Tags</span>
        <span>{tags.length}/{MAX_TAGS}</span>
      </div>
      <div className="note-tags-editor" aria-label="便签标签">
        {tags.map((tag) => (
          <span
            key={tag.toLowerCase()}
            className={`note-tag-chip${inlineTagKeys.has(tag.toLowerCase()) ? " is-inline" : ""}`}
            title={inlineTagKeys.has(tag.toLowerCase()) ? "正文标签" : undefined}
          >
            <span>#{tag}</span>
            {!inlineTagKeys.has(tag.toLowerCase()) && (
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                title={`移除 ${tag}`}
                onClick={() => onChange({ tags: tags.filter((item) => item !== tag) })}
              >
                <X size={10} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        {tags.length < MAX_TAGS && (
          <input
            value={tagDraft}
            maxLength={40}
            placeholder={tags.length === 0 ? "添加 tag" : "+ tag"}
            aria-label="添加标签"
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={() => commitTag()}
          />
        )}
      </div>

      {tags.length < MAX_TAGS && tagSuggestions.length > 0 && (
        <div className="note-tag-suggestions" aria-label="已有标签">
          {tagSuggestions.map((tag) => (
            <button
              key={tag.toLowerCase()}
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commitTag(tag)}
            >
              <Plus size={10} aria-hidden="true" />
              <span>{tag}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { emacsMotionTarget, type EmacsMotionKey } from "../editor/emacs-motion";
import { markdownListIndentKeyBinding } from "../editor/markdown-list-indent";
import { markdownLinePreview, markdownTagDecorations, type MarkdownReplacement } from "../editor/markdown-preview";

interface NoteEditorProps {
  autoFocus?: boolean;
  content: string;
  highlightedTags: string[];
  onChange: (content: string) => void;
}

export interface NoteEditorHandle {
  focus: () => void;
}

const refreshMarkdownPreview = StateEffect.define<void>();

class ListMarkerWidget extends WidgetType {
  constructor(readonly replacement: Exclude<MarkdownReplacement, { kind: "task" }>) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return JSON.stringify(this.replacement) === JSON.stringify(other.replacement);
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = `cm-md-list-marker cm-md-list-marker-${this.replacement.kind}`;
    marker.textContent = this.replacement.kind === "bullet" ? "\u2022" : this.replacement.label;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly checkFrom: number) {
    super();
  }

  eq(other: TaskMarkerWidget) {
    return this.checked === other.checked && this.checkFrom === other.checkFrom;
  }

  toDOM(view: EditorView) {
    const marker = document.createElement("span");
    marker.className = "cm-md-task-marker";

    const input = document.createElement("input");
    input.className = "cm-md-task-checkbox";
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为已完成");
    input.addEventListener("change", () => {
      view.dispatch({
        changes: { from: this.checkFrom, to: this.checkFrom + 1, insert: input.checked ? "x" : " " },
      });
    });
    marker.append(input);
    return marker;
  }

  ignoreEvent() {
    return true;
  }
}

function replacementWidget(replacement: MarkdownReplacement) {
  if (replacement.kind === "task") return new TaskMarkerWidget(replacement.checked, replacement.checkFrom);
  return new ListMarkerWidget(replacement);
}

function buildPreviewDecorations(view: EditorView, highlightedTags: readonly string[]) {
  const ranges: Array<Range<Decoration>> = [];
  const atomicRanges: Array<Range<Decoration>> = [];
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const preview = markdownLinePreview(line.text, line.from, lineNumber === activeLine);
    if (preview.className) {
      ranges.push(Decoration.line({ attributes: { class: preview.className } }).range(line.from));
    }
    for (const decoration of preview.decorations) {
      if (decoration.kind === "hide") {
        const range = Decoration.replace({}).range(decoration.from, decoration.to);
        ranges.push(range);
        atomicRanges.push(range);
      } else if (decoration.kind === "replace") {
        const range = Decoration.replace({ widget: replacementWidget(decoration.replacement) })
          .range(decoration.from, decoration.to);
        ranges.push(range);
        atomicRanges.push(range);
      } else if (decoration.from < decoration.to) {
        ranges.push(Decoration.mark({ class: decoration.className }).range(decoration.from, decoration.to));
      }
    }
  }

  for (const decoration of markdownTagDecorations(view.state.doc.toString(), highlightedTags)) {
    if (decoration.kind === "mark" && decoration.from < decoration.to) {
      ranges.push(Decoration.mark({ class: decoration.className }).range(decoration.from, decoration.to));
    }
  }

  return {
    atomicRanges: Decoration.set(atomicRanges, true),
    decorations: Decoration.set(ranges, true),
  };
}

function markdownPreviewExtension(highlightedTags: { current: readonly string[] }) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomicRanges: DecorationSet;

      constructor(view: EditorView) {
        const preview = buildPreviewDecorations(view, highlightedTags.current);
        this.decorations = preview.decorations;
        this.atomicRanges = preview.atomicRanges;
      }

      update(update: ViewUpdate) {
        const refreshRequested = update.transactions.some((transaction) => (
          transaction.effects.some((effect) => effect.is(refreshMarkdownPreview))
        ));
        if (update.docChanged || update.selectionSet || update.viewportChanged || refreshRequested) {
          const preview = buildPreviewDecorations(update.view, highlightedTags.current);
          this.decorations = preview.decorations;
          this.atomicRanges = preview.atomicRanges;
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
  ];
}

function moveSelection(view: EditorView, target: number) {
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  return true;
}

function runEmacsMotion(view: EditorView, key: EmacsMotionKey) {
  const selection = view.state.selection.main;
  if (key === "b" || key === "f") {
    const start = EditorSelection.cursor(key === "b" ? selection.from : selection.to);
    return moveSelection(view, view.moveByChar(start, key === "f").head);
  }
  const target = emacsMotionTarget(view.state.doc.toString(), selection.from, selection.to, key);
  return moveSelection(view, target);
}

const emacsKeymap = [
  {
    key: "Ctrl-a",
    run: (view: EditorView) => runEmacsMotion(view, "a"),
  },
  {
    key: "Ctrl-e",
    run: (view: EditorView) => runEmacsMotion(view, "e"),
  },
  {
    key: "Ctrl-b",
    run: (view: EditorView) => runEmacsMotion(view, "b"),
  },
  {
    key: "Ctrl-f",
    run: (view: EditorView) => runEmacsMotion(view, "f"),
  },
  {
    key: "Ctrl-p",
    run: (view: EditorView) => runEmacsMotion(view, "p"),
  },
  {
    key: "Ctrl-n",
    run: (view: EditorView) => runEmacsMotion(view, "n"),
  },
];

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { autoFocus = true, content, highlightedTags, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternalValue = useRef(false);
  const highlightedTagsRef = useRef<readonly string[]>(highlightedTags);

  onChangeRef.current = onChange;
  highlightedTagsRef.current = highlightedTags;

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({
            "aria-label": "便签内容",
            autocapitalize: "sentences",
            spellcheck: "true",
          }),
          keymap.of([markdownListIndentKeyBinding, ...emacsKeymap, ...standardKeymap, ...historyKeymap]),
          placeholder("写点什么"),
          markdownPreviewExtension(highlightedTagsRef),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternalValue.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    applyingExternalValue.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    applyingExternalValue.current = false;
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: refreshMarkdownPreview.of(undefined) });
  }, [highlightedTags]);

  return <div ref={hostRef} className="note-editor" />;
});

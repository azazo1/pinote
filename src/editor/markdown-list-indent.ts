import { countColumn, type ChangeSpec, type EditorState, type StateCommand } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { markdownCodeBlockLines } from "./markdown-preview";

const INDENT_WIDTH = 4;
const LIST_MARKER = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]{1,4}|$)/;

interface ListLineInfo {
  lineFrom: number;
  indentText: string;
  indentColumns: number;
}

function listLineInfo(
  state: EditorState,
  lineNumber: number,
  codeBlockLines: Map<number, unknown>,
): ListLineInfo | null {
  if (codeBlockLines.has(lineNumber)) return null;

  const line = state.doc.line(lineNumber);
  const match = LIST_MARKER.exec(line.text);
  if (!match) return null;

  return {
    lineFrom: line.from,
    indentText: match[1],
    indentColumns: countColumn(match[1], state.tabSize),
  };
}

function selectedLineNumbers(state: EditorState) {
  const lineNumbers = new Set<number>();

  for (const range of state.selection.ranges) {
    for (let position = range.from; position <= range.to;) {
      const line = state.doc.lineAt(position);
      if (range.empty || range.to > line.from) lineNumbers.add(line.number);
      position = line.to + 1;
    }
  }

  return lineNumbers;
}

function adjustIndent(direction: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const lineNumbers = selectedLineNumbers(state);
    if (lineNumbers.size === 0) return false;

    const codeBlockLines = markdownCodeBlockLines(state);
    const changes: ChangeSpec[] = [];
    let matchedListLine = false;

    for (const lineNumber of [...lineNumbers].sort((left, right) => left - right)) {
      const info = listLineInfo(state, lineNumber, codeBlockLines);
      if (!info) continue;
      matchedListLine = true;

      const target = direction > 0
        ? info.indentColumns + INDENT_WIDTH
        : Math.max(0, info.indentColumns - INDENT_WIDTH);
      if (target === info.indentColumns) continue;

      changes.push({
        from: info.lineFrom,
        to: info.lineFrom + info.indentText.length,
        insert: " ".repeat(target),
      });
    }

    if (!matchedListLine) return false;
    if (changes.length > 0) {
      dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.indent" }));
    }
    return true;
  };
}

export const indentMarkdownList = adjustIndent(1);
export const dedentMarkdownList = adjustIndent(-1);

export const markdownListIndentKeyBinding: KeyBinding = {
  key: "Tab",
  run: indentMarkdownList,
  shift: dedentMarkdownList,
};

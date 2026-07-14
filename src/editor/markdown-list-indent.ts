import { indentLess, indentMore } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, StateCommand } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

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

function selectionContainsListItem(state: EditorState) {
  const lineNumbers = selectedLineNumbers(state);
  let containsListItem = false;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "ListMark" && lineNumbers.has(state.doc.lineAt(node.from).number)) {
        containsListItem = true;
      }
    },
  });

  return containsListItem;
}

function forMarkdownList(command: StateCommand): StateCommand {
  return (target) => selectionContainsListItem(target.state) && command(target);
}

export const indentMarkdownList = forMarkdownList(indentMore);
export const dedentMarkdownList = forMarkdownList(indentLess);

export const markdownListIndentKeyBinding: KeyBinding = {
  key: "Tab",
  run: indentMarkdownList,
  shift: dedentMarkdownList,
};

import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { dedentMarkdownList, indentMarkdownList } from "./markdown-list-indent";

function runCommand(doc: string, command: StateCommand, anchor = doc.length, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown()],
  });
  const handled = command({
    state,
    dispatch(transaction) {
      state = transaction.state;
    },
  });
  return { handled, doc: state.doc.toString() };
}

describe("Markdown list indentation", () => {
  it.each([
    "- unordered",
    "1. ordered",
    "- [ ] task",
  ])("indents a list item with Tab", (doc) => {
    expect(runCommand(doc, indentMarkdownList)).toEqual({ handled: true, doc: `  ${doc}` });
  });

  it("dedents a list item with Shift+Tab", () => {
    expect(runCommand("  - [x] task", dedentMarkdownList)).toEqual({ handled: true, doc: "- [x] task" });
  });

  it("indents every selected list item", () => {
    const doc = "- first\n- second";
    expect(runCommand(doc, indentMarkdownList, 0, doc.length)).toEqual({
      handled: true,
      doc: "  - first\n  - second",
    });
  });

  it("leaves Tab available outside lists", () => {
    expect(runCommand("plain text", indentMarkdownList)).toEqual({ handled: false, doc: "plain text" });
  });
});

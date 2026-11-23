import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { dedentMarkdownList, indentMarkdownList } from "./markdown-list-indent";

function runCommand(doc: string, command: StateCommand, anchor = doc.length, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown(), EditorState.tabSize.of(4)],
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
  ])("indents a list item by one four-space level with Tab", (doc) => {
    expect(runCommand(doc, indentMarkdownList)).toEqual({ handled: true, doc: `    ${doc}` });
  });

  it("dedents a list item by one four-space level with Shift+Tab", () => {
    expect(runCommand("    - [x] task", dedentMarkdownList)).toEqual({ handled: true, doc: "- [x] task" });
  });

  it("keeps one level when the indent is not a multiple of four", () => {
    expect(runCommand("  1. ordered", dedentMarkdownList)).toEqual({ handled: true, doc: "1. ordered" });
  });

  it("dedents a list nested more than one level", () => {
    const doc = "- a\n        - b";
    expect(runCommand(doc, dedentMarkdownList)).toEqual({ handled: true, doc: "- a\n    - b" });
  });

  it("consumes Shift+Tab on a top-level list item instead of moving focus", () => {
    expect(runCommand("- item", dedentMarkdownList)).toEqual({ handled: true, doc: "- item" });
  });

  it("indents a four-space indented list line that Markdown reads as a code block", () => {
    expect(runCommand("    - item", dedentMarkdownList)).toEqual({ handled: true, doc: "- item" });
  });

  it("indents every selected list item", () => {
    const doc = "- first\n- second";
    expect(runCommand(doc, indentMarkdownList, 0, doc.length)).toEqual({
      handled: true,
      doc: "    - first\n    - second",
    });
  });

  it("leaves Tab available outside lists", () => {
    expect(runCommand("plain text", indentMarkdownList)).toEqual({ handled: false, doc: "plain text" });
  });

  it("ignores list-looking lines inside fenced code blocks", () => {
    const doc = "```\n- item\n```";
    expect(runCommand(doc, indentMarkdownList, 6)).toEqual({ handled: false, doc });
  });
});

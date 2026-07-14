import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownCodeBlockLines, markdownLinePreview, markdownTagDecorations } from "./markdown-preview";

describe("markdownLinePreview", () => {
  it("hides block markers outside the active line", () => {
    const preview = markdownLinePreview("## Heading", 10, false);

    expect(preview.className).toBe("cm-md-heading cm-md-heading-2");
    expect(preview.decorations).toContainEqual({ kind: "hide", from: 10, to: 13 });
  });

  it("keeps markers visible on the active line while styling content", () => {
    const preview = markdownLinePreview("**strong** and _soft_", 0, true);

    expect(preview.decorations).toEqual([
      { kind: "mark", from: 2, to: 8, className: "cm-md-strong" },
      { kind: "mark", from: 16, to: 20, className: "cm-md-emphasis" },
    ]);
  });

  it("describes an interactive task marker", () => {
    const preview = markdownLinePreview("  - [x] done", 20, false);

    expect(preview.className).toBe("cm-md-list-line cm-md-task-line cm-md-task-complete");
    expect(preview.decorations[0]).toEqual({
      kind: "replace",
      from: 22,
      to: 28,
      replacement: { kind: "task", checked: true, checkFrom: 25 },
    });
  });

  it("replaces the complete task marker on the active line", () => {
    const preview = markdownLinePreview(" - [ ] todo", 40, true);

    expect(preview.className).toBe("cm-md-list-line cm-md-task-line");
    expect(preview.decorations).toEqual([
      {
        kind: "replace",
        from: 41,
        to: 47,
        replacement: { kind: "task", checked: false, checkFrom: 44 },
      },
    ]);
  });

  it("keeps additional spaces after the task separator editable", () => {
    const preview = markdownLinePreview("- [ ]   todo", 0, true);

    expect(preview.decorations).toEqual([
      {
        kind: "replace",
        from: 0,
        to: 6,
        replacement: { kind: "task", checked: false, checkFrom: 3 },
      },
    ]);
  });

  it("does not interpret escaped inline markers", () => {
    const preview = markdownLinePreview("\\*literal*", 0, false);

    expect(preview.decorations).toEqual([]);
  });

  it("does not interpret underscores inside words as emphasis", () => {
    expect(markdownLinePreview("hello_world hello_world", 0, false).decorations).toEqual([]);
    expect(markdownLinePreview("before__middle__after", 0, false).decorations).toEqual([]);
  });

  it("keeps fenced code content literal", () => {
    const document = ["before", "```ts", "hello_world hello_world", "*literal*", "```", "after"].join("\n");
    const state = EditorState.create({ doc: document, extensions: [markdown()] });
    const codeBlockLines = markdownCodeBlockLines(state);

    expect([...codeBlockLines]).toEqual([
      [2, "fence"],
      [3, "content"],
      [4, "content"],
      [5, "fence"],
    ]);
    expect(markdownLinePreview("hello_world hello_world", 13, false, codeBlockLines.get(3))).toEqual({
      className: "cm-md-code-block cm-md-code-content",
      decorations: [],
    });
  });

  it("highlights document tags outside protected Markdown ranges", () => {
    expect(markdownTagDecorations("Text #Rust")).toContainEqual({
      kind: "mark",
      from: 5,
      to: 10,
      className: "cm-md-tag",
    });
    expect(markdownTagDecorations("`#code` and \\#plain\n```\n#fenced\n```\n[jump](#anchor)")).not.toContainEqual(
      expect.objectContaining({ className: "cm-md-tag" }),
    );
    expect(markdownTagDecorations("Text #Rust", [])).toEqual([]);
    expect(markdownTagDecorations(`#${"x".repeat(41)}`, ["x".repeat(40)])).toEqual([
      { kind: "mark", from: 0, to: 41, className: "cm-md-tag" },
    ]);
  });
});

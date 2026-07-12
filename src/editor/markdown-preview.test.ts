import { describe, expect, it } from "vitest";
import { markdownLinePreview } from "./markdown-preview";

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

  it("does not interpret escaped inline markers", () => {
    const preview = markdownLinePreview("\\*literal*", 0, false);

    expect(preview.decorations).toEqual([]);
  });
});

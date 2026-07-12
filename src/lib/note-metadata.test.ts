import { describe, expect, it } from "vitest";
import {
  addTag,
  combineTagSources,
  extractInlineTags,
  findInlineTags,
  normalizeGroupName,
  normalizeTags,
  reconcileInlineTags,
} from "./note-metadata";

describe("note metadata", () => {
  it("normalizes group names and tags", () => {
    expect(normalizeGroupName("  Work  ")).toBe("Work");
    expect(normalizeTags([" Rust ", "rust", "#Electron", ""])).toEqual(["Rust", "Electron"]);
  });

  it("adds tags without changing existing spelling", () => {
    expect(addTag(["Rust"], "RUST")).toEqual(["Rust"]);
    expect(addTag(["Rust"], "Electron")).toEqual(["Rust", "Electron"]);
  });

  it("extracts inline tags without treating markdown syntax as tags", () => {
    const markdown = "# Heading\nText #Rust and #中文/tag\n`#code` \\#escaped\n```\n#fenced\n```";

    expect(extractInlineTags(markdown)).toEqual(["Rust", "中文/tag"]);
    expect(findInlineTags("prefix #one")).toEqual([{ from: 7, to: 11, tag: "one" }]);
  });

  it("skips link targets and matched fenced code", () => {
    const markdown = [
      "[jump](#section) and [#label](page)",
      "Text #visible",
      "```md",
      "#hidden",
      "~~~",
      "#still-hidden",
      "```",
      "After #done and `#code`",
    ].join("\n");

    expect(extractInlineTags(markdown)).toEqual(["visible", "done"]);
  });

  it("uses Obsidian-compatible numeric and hierarchy rules", () => {
    expect(extractInlineTags("#123 #project/alpha #/broken #trailing/ #2026-07")).toEqual([
      "project/alpha",
      "2026-07",
    ]);
    expect(extractInlineTags("Unmatched ` marker #tag")).toEqual(["tag"]);
  });

  it("replaces previous inline tags while retaining manual tags", () => {
    expect(reconcileInlineTags(["Manual", "old"], ["old"], "Text #new")).toEqual({
      manualTags: ["Manual"],
      inlineTags: ["new"],
      tags: ["Manual", "new"],
    });
  });

  it("keeps inline tag recognition within the persisted limit", () => {
    const manualTags = Array.from({ length: 16 }, (_, index) => `manual-${index}`);

    expect(combineTagSources(manualTags, ["fresh"])).toMatchObject({
      manualTags,
      inlineTags: [],
      tags: manualTags,
    });
  });

  it("truncates metadata by Unicode code point", () => {
    const letter = String.fromCodePoint(0x10330);
    const tag = `${"x".repeat(39)}${letter}tail`;

    expect(normalizeTags([tag])).toEqual([`${"x".repeat(39)}${letter}`]);
    expect(normalizeGroupName(`${"g".repeat(79)}${letter}tail`)).toBe(`${"g".repeat(79)}${letter}`);
  });
});

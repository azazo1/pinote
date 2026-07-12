import { describe, expect, it } from "vitest";
import { emacsMotionTarget } from "./emacs-motion";

describe("emacsMotionTarget", () => {
  const document = "first\nxy\nlast";

  it("moves to line boundaries", () => {
    expect(emacsMotionTarget(document, 8, 8, "a")).toBe(6);
    expect(emacsMotionTarget(document, 8, 8, "e")).toBe(8);
  });

  it("moves horizontally without splitting surrogate pairs", () => {
    const value = "a\ud83d\udc4db";
    expect(emacsMotionTarget(value, 3, 3, "b")).toBe(1);
    expect(emacsMotionTarget(value, 1, 1, "f")).toBe(3);
  });

  it("keeps the column when moving vertically", () => {
    expect(emacsMotionTarget(document, 2, 2, "n")).toBe(8);
    expect(emacsMotionTarget(document, 12, 12, "p")).toBe(8);
  });

  it("stops at document boundaries", () => {
    expect(emacsMotionTarget(document, 0, 0, "p")).toBe(0);
    expect(emacsMotionTarget(document, document.length, document.length, "n")).toBe(document.length);
  });
});

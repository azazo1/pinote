import { describe, expect, it } from "vitest";
import { NOTE_RESIZE_EDGES, resizeWindowBounds } from "./window-resize";

describe("便签窗口调整大小", () => {
  it("不提供右上角调整句柄", () => {
    expect(NOTE_RESIZE_EDGES).not.toContain("ne");
  });

  it("从左上角调整时固定右下角", () => {
    expect(resizeWindowBounds(
      { x: 100, y: 80, width: 360, height: 300 },
      "nw",
      40,
      30,
    )).toEqual({ x: 140, y: 110, width: 320, height: 270 });
  });

  it("达到最小尺寸后不继续移动锚点", () => {
    expect(resizeWindowBounds(
      { x: 100, y: 80, width: 300, height: 220 },
      "nw",
      200,
      200,
    )).toEqual({ x: 147, y: 120, width: 253, height: 180 });
  });
});

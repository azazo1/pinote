import { describe, expect, it } from "vitest";
import { shelfWorkspaceLayout } from "./shelf-workspace-bounds.mjs";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const noteBounds = { x: 0, y: 0, width: 360, height: 300 };

describe("shelfWorkspaceLayout", () => {
  it("keeps a right shelf fixed while opening the editor inward", () => {
    expect(shelfWorkspaceLayout({
      area,
      edge: "right",
      listBounds: { x: 1232, y: 300, width: 200, height: 110 },
      noteBounds,
      collapsed: false,
    })).toEqual({
      bounds: { x: 872, y: 205, width: 560, height: 300 },
      metrics: { editorSide: "left", editorWidth: 360, editorHeight: 300 },
    });
  });

  it("keeps a left shelf fixed while opening the editor inward", () => {
    expect(shelfWorkspaceLayout({
      area,
      edge: "left",
      listBounds: { x: 8, y: 300, width: 200, height: 110 },
      noteBounds,
      collapsed: false,
    })).toEqual({
      bounds: { x: 8, y: 205, width: 560, height: 300 },
      metrics: { editorSide: "right", editorWidth: 360, editorHeight: 300 },
    });
  });

  it("chooses the larger side for a free shelf", () => {
    const layout = shelfWorkspaceLayout({
      area,
      edge: "free",
      listBounds: { x: 1000, y: 300, width: 200, height: 110 },
      noteBounds,
      collapsed: false,
    });
    expect(layout.metrics.editorSide).toBe("left");
    expect(layout.bounds.x).toBe(640);
  });

  it("clamps the editor on a narrow display", () => {
    const layout = shelfWorkspaceLayout({
      area: { x: -800, y: 0, width: 480, height: 270 },
      edge: "right",
      listBounds: { x: -528, y: 80, width: 200, height: 110 },
      noteBounds: { x: 0, y: 0, width: 760, height: 900 },
      collapsed: false,
    });
    expect(layout.bounds).toEqual({ x: -800, y: 0, width: 480, height: 270 });
    expect(layout.metrics).toEqual({ editorSide: "left", editorWidth: 280, editorHeight: 270 });
  });

  it("uses collapsed note dimensions", () => {
    const layout = shelfWorkspaceLayout({
      area,
      edge: "right",
      listBounds: { x: 1232, y: 300, width: 200, height: 110 },
      noteBounds,
      collapsed: true,
    });
    expect(layout.metrics).toEqual({ editorSide: "left", editorWidth: 253, editorHeight: 22 });
    expect(layout.bounds.height).toBe(110);
  });
});

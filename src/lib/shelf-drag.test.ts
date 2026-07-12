import { describe, expect, it } from "vitest";
import { shelfDragThreshold, shouldStartShelfDrag } from "./shelf-drag";

describe("shouldStartShelfDrag", () => {
  it("keeps movement at the threshold as a click", () => {
    expect(shouldStartShelfDrag(shelfDragThreshold, 0)).toBe(false);
  });

  it("starts dragging after the threshold", () => {
    expect(shouldStartShelfDrag(shelfDragThreshold, 1)).toBe(true);
  });
});

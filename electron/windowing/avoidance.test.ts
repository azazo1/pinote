import { describe, expect, it } from "vitest";
import {
  avoidanceExitBounds,
  avoidanceExitDirection,
  avoidanceExitDuration,
  avoidanceReturnDuration,
  boundsDistance,
  easeInQuad,
  easeOutCubic,
  isAvoidanceTarget,
} from "./avoidance.mjs";

const area = { x: 0, y: 0, width: 1440, height: 900 };

describe("avoidanceExitDirection", () => {
  it("sends a note in the middle of the screen downward", () => {
    expect(avoidanceExitDirection({ x: 600, y: 380, width: 253, height: 220 }, area)).toBe("bottom");
  });

  it("sends a note near the left edge leftward", () => {
    expect(avoidanceExitDirection({ x: 10, y: 300, width: 253, height: 220 }, area)).toBe("left");
  });

  it("sends a note near the right edge rightward", () => {
    expect(avoidanceExitDirection({ x: 1200, y: 300, width: 253, height: 220 }, area)).toBe("right");
  });

  it("sends a note near the top edge upward", () => {
    expect(avoidanceExitDirection({ x: 600, y: 10, width: 253, height: 220 }, area)).toBe("top");
  });

  it("falls back to the original bounds when input is invalid", () => {
    const bounds = { x: 10, y: 10, width: 100, height: 100 };
    expect(avoidanceExitBounds(bounds, null)).toBe(bounds);
  });
});

describe("avoidanceExitBounds", () => {
  it("leaves the note fully outside the work area with the size unchanged", () => {
    const bounds = { x: 600, y: 380, width: 253, height: 220 };
    const target = avoidanceExitBounds(bounds, area);

    expect(target.y).toBeGreaterThanOrEqual(area.y + area.height);
    expect(target.width).toBe(bounds.width);
    expect(target.height).toBe(bounds.height);
  });

  it("offsets the note sideways so the path is not a straight line", () => {
    const bounds = { x: 10, y: 300, width: 253, height: 220 };
    const target = avoidanceExitBounds(bounds, area);

    expect(target.x + target.width).toBeLessThan(area.x);
    expect(target.y).toBeGreaterThan(bounds.y);
  });
});

describe("avoidance durations", () => {
  it("grows with the distance and stays within limits", () => {
    const near = { x: 0, y: 0, width: 100, height: 100 };
    const far = { x: 0, y: 800, width: 100, height: 100 };

    expect(avoidanceExitDuration(near, near)).toBe(340);
    expect(avoidanceExitDuration(near, far)).toBeGreaterThan(avoidanceExitDuration(near, near));
    expect(avoidanceExitDuration({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 5000, width: 1, height: 1 })).toBe(720);
    expect(avoidanceReturnDuration(near, far)).toBeLessThanOrEqual(620);
    expect(avoidanceReturnDuration(near, far)).toBeGreaterThanOrEqual(300);
  });
});

describe("isAvoidanceTarget", () => {
  const bounds = { x: 600, y: 380, width: 253, height: 220 };

  it("matches a pointer on the note", () => {
    expect(isAvoidanceTarget({ x: 700, y: 500 }, bounds)).toBe(true);
  });

  it("matches a pointer slightly outside the note", () => {
    expect(isAvoidanceTarget({ x: 590, y: 500 }, bounds)).toBe(true);
  });

  it("ignores a pointer far away", () => {
    expect(isAvoidanceTarget({ x: 100, y: 100 }, bounds)).toBe(false);
  });
});

describe("easing", () => {
  it("anchors at both ends", () => {
    expect(easeInQuad(0)).toBe(0);
    expect(easeInQuad(1)).toBe(1);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("accelerates the exit and decelerates the return", () => {
    expect(easeInQuad(0.5)).toBeLessThan(0.5);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("boundsDistance", () => {
  it("measures between window centers", () => {
    expect(boundsDistance({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 400, width: 100, height: 100 })).toBe(500);
  });
});

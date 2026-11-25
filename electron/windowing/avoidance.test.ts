import { describe, expect, it } from "vitest";
import {
  AVOIDANCE_RADIUS,
  approachBounds,
  avoidanceField,
  avoidancePushTarget,
  boundsSettled,
  rectIntersectsCircle,
} from "./avoidance.mjs";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const note = { x: 600, y: 380, width: 253, height: 220 };
const circle = { x: 700, y: 500, radius: 152 };

describe("avoidanceField", () => {
  it("centers the field on the pointer with the gap included", () => {
    expect(avoidanceField({ x: 700, y: 500 })).toEqual({ x: 700, y: 500, radius: AVOIDANCE_RADIUS + 12 });
  });

  it("ignores an invalid pointer", () => {
    expect(avoidanceField(null)).toBeNull();
  });
});

describe("rectIntersectsCircle", () => {
  it("detects a circle over the note", () => {
    expect(rectIntersectsCircle(note, circle)).toBe(true);
  });

  it("detects a circle cutting a corner", () => {
    expect(rectIntersectsCircle(note, { x: 590, y: 370, radius: 30 })).toBe(true);
  });

  it("ignores a circle far away", () => {
    expect(rectIntersectsCircle(note, { x: 100, y: 100, radius: 60 })).toBe(false);
  });
});

describe("avoidancePushTarget", () => {
  it("keeps the note at the same size and outside the field", () => {
    const target = avoidancePushTarget(note, circle, area);

    expect(target.width).toBe(note.width);
    expect(target.height).toBe(note.height);
    expect(rectIntersectsCircle(target, circle)).toBe(false);
  });

  it("moves as little as possible so the note stays beside the field", () => {
    const target = avoidancePushTarget(note, circle, area);
    const distance = Math.hypot(target.x - note.x, target.y - note.y);

    // 便签有一半落在立场里, 推开距离应接近半个便签宽/高, 而不是飞到屏幕边缘.
    expect(distance).toBeLessThanOrEqual(300);
  });

  it("stays inside the work area", () => {
    const target = avoidancePushTarget(note, circle, area);

    expect(target.x).toBeGreaterThanOrEqual(area.x);
    expect(target.y).toBeGreaterThanOrEqual(area.y);
    expect(target.x + target.width).toBeLessThanOrEqual(area.x + area.width);
    expect(target.y + target.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it("returns the original bounds when the note is not in the field", () => {
    expect(avoidancePushTarget(note, { x: 100, y: 100, radius: 50 }, area)).toBe(note);
  });
});

describe("approachBounds", () => {
  it("snaps when close enough", () => {
    expect(approachBounds({ x: 100, y: 100, width: 10, height: 10 }, { x: 101, y: 101, width: 10, height: 10 })).toEqual({
      x: 101,
      y: 101,
      width: 10,
      height: 10,
    });
  });

  it("moves part of the way each frame", () => {
    const next = approachBounds({ x: 0, y: 0, width: 10, height: 10 }, { x: 200, y: 100, width: 10, height: 10 }, 0.5);

    expect(next.x).toBe(100);
    expect(next.y).toBe(50);
  });
});

describe("boundsSettled", () => {
  it("treats a small offset as settled", () => {
    expect(boundsSettled({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
    expect(boundsSettled({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
  });
});

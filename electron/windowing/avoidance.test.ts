import { describe, expect, it } from "vitest";
import {
  AVOIDANCE_RADIUS,
  approachBounds,
  avoidanceField,
  avoidancePushCandidates,
  boundsSettled,
  rectIntersectsCircle,
} from "./avoidance.mjs";

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

describe("avoidancePushCandidates", () => {
  it("sorts candidates by distance and keeps the note size", () => {
    const candidates = avoidancePushCandidates(note, circle);

    expect(candidates[0].direction).toBe("right");
    expect(candidates[0].target).toMatchObject({ width: note.width, height: note.height });
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index].distance).toBeGreaterThanOrEqual(candidates[index - 1].distance);
    }
  });

  it("demotes the move that would cross a menu bar or taskbar gap", () => {
    const pill = { x: 100, y: 55, width: 253, height: 22 };
    const field = { x: 230, y: 145, radius: 152 };
    const topGap = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
    };

    // 没有显示器信息时, 向上位移最小.
    expect(avoidancePushCandidates(pill, field)[0].direction).toBe("up");
    // 顶部缺口 (菜单栏) 会挡住向上, 应改走下方.
    expect(avoidancePushCandidates(pill, field, topGap)[0].direction).toBe("down");

    // 底部任务栏同理: 在下方让位时会越过任务栏, 应改走上方.
    const bottomPill = { x: 100, y: 800, width: 253, height: 22 };
    const bottomField = { x: 200, y: 760, radius: 152 };
    const bottomGap = {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 860 },
    };
    expect(avoidancePushCandidates(bottomPill, bottomField)[0].direction).toBe("down");
    expect(avoidancePushCandidates(bottomPill, bottomField, bottomGap)[0].direction).toBe("up");
  });

  it("lets a large note pass the screen edge to clear the field", () => {
    const large = { x: 640, y: 100, width: 800, height: 700 };
    const candidates = avoidancePushCandidates(large, { x: 660, y: 450, radius: 152 });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].direction).toBe("right");
    expect(candidates[0].target.x).toBe(812);
    // 允许移出屏幕: 不再被工作区边界夹回立场内.
    expect(candidates[0].target.x + large.width).toBeGreaterThan(1440);
  });

  it("returns nothing for invalid input", () => {
    expect(avoidancePushCandidates(null, circle)).toEqual([]);
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

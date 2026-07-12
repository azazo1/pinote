import { describe, expect, it } from "vitest";
import { SNAP_THRESHOLD, snapBounds } from "./snap-bounds.mjs";

const workArea = { x: 0, y: 0, width: 1000, height: 700 };

describe("snapBounds", () => {
  it("snaps to every work area edge", () => {
    expect(snapBounds({ x: 7, y: 6, width: 200, height: 120 }, [], workArea)).toMatchObject({ x: 0, y: 0 });
    expect(snapBounds({ x: 794, y: 574, width: 200, height: 120 }, [], workArea)).toMatchObject({ x: 800, y: 580 });
  });

  it("aligns matching horizontal edges when vertical ranges are near", () => {
    const target = { x: 300, y: 100, width: 180, height: 200 };

    expect(snapBounds({ x: 307, y: 130, width: 120, height: 90 }, [target], workArea).x).toBe(300);
    expect(snapBounds({ x: 366, y: 130, width: 120, height: 90 }, [target], workArea).x).toBe(360);
  });

  it("attaches neighboring horizontal edges", () => {
    const target = { x: 300, y: 100, width: 180, height: 200 };

    expect(snapBounds({ x: 473, y: 140, width: 120, height: 90 }, [target], workArea).x).toBe(480);
    expect(snapBounds({ x: 187, y: 140, width: 120, height: 90 }, [target], workArea).x).toBe(180);
  });

  it("aligns and attaches vertical edges when horizontal ranges are near", () => {
    const target = { x: 240, y: 220, width: 240, height: 160 };

    expect(snapBounds({ x: 280, y: 226, width: 120, height: 80 }, [target], workArea).y).toBe(220);
    expect(snapBounds({ x: 280, y: 294, width: 120, height: 80 }, [target], workArea).y).toBe(300);
    expect(snapBounds({ x: 280, y: 374, width: 120, height: 80 }, [target], workArea).y).toBe(380);
    expect(snapBounds({ x: 280, y: 147, width: 120, height: 80 }, [target], workArea).y).toBe(140);
  });

  it("ignores an axis when perpendicular ranges are too far apart", () => {
    const target = { x: 300, y: 400, width: 180, height: 120 };
    const result = snapBounds({ x: 306, y: 100, width: 120, height: 90 }, [target], workArea);

    expect(result.x).toBe(306);
  });

  it("allows a perpendicular gap up to the snap threshold", () => {
    const target = { x: 300, y: 200, width: 180, height: 120 };
    const result = snapBounds(
      { x: 306, y: 100, width: 120, height: 90 },
      [target],
      workArea,
      SNAP_THRESHOLD,
    );

    expect(result.x).toBe(300);
  });

  it("selects the candidate with the smallest absolute movement", () => {
    const targets = [
      { x: 100, y: 100, width: 120, height: 100 },
      { x: 98, y: 100, width: 120, height: 100 },
    ];
    const result = snapBounds({ x: 96, y: 120, width: 80, height: 60 }, targets, workArea);

    expect(result.x).toBe(98);
  });

  it("snaps both axes independently", () => {
    const target = { x: 100, y: 200, width: 160, height: 120 };
    expect(snapBounds({ x: 106, y: 207, width: 100, height: 80 }, [target], workArea)).toMatchObject({ x: 100, y: 200 });
  });

  it("does not turn a work area edge into a hard multi-display boundary", () => {
    expect(snapBounds({ x: -40, y: 680, width: 100, height: 80 }, [], workArea)).toMatchObject({ x: -40, y: 680 });
  });
});

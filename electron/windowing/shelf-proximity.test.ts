import { describe, expect, it } from "vitest";
import { isPointNearBounds, SHELF_DOCK_PROXIMITY } from "./shelf-proximity.mjs";

const shelf = { x: 1200, y: 300, width: 36, height: 36 };

describe("isPointNearBounds", () => {
  it("接受侧边球内部和临近范围内的指针", () => {
    expect(isPointNearBounds({ x: 1218, y: 318 }, shelf)).toBe(true);
    expect(isPointNearBounds({ x: 1200 - SHELF_DOCK_PROXIMITY, y: 318 }, shelf)).toBe(true);
    expect(isPointNearBounds({ x: 1218, y: 336 + SHELF_DOCK_PROXIMITY }, shelf)).toBe(true);
  });

  it("拒绝临近范围外和无效的坐标", () => {
    expect(isPointNearBounds({ x: 1200 - SHELF_DOCK_PROXIMITY - 1, y: 318 }, shelf)).toBe(false);
    expect(isPointNearBounds({ x: Number.NaN, y: 318 }, shelf)).toBe(false);
    expect(isPointNearBounds({ x: 1218, y: 318 }, shelf, -1)).toBe(false);
  });
});

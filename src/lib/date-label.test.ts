import { describe, expect, it } from "vitest";
import { dateLabel } from "./date-label";

describe("dateLabel", () => {
  it("formats a stable local date label", () => {
    const date = new Date(2026, 6, 12, 10, 0, 0);
    expect(dateLabel(date.getTime())).toBe("星期日, 7 月 12 日");
  });
});

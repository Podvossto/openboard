import { describe, expect, it } from "vitest";
import { contains, probePoints, sameRect } from "./browser";

describe("native browser placement", () => {
  it("sameRect tolerates sub-pixel jitter only", () => {
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1.2, y: 2, w: 3, h: 4.3 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 2, y: 2, w: 3, h: 4 })).toBe(false);
    expect(sameRect(null, { x: 0, y: 0, w: 0, h: 0 })).toBe(false);
  });
  it("contains = fully inside", () => {
    const stage = { x: 64, y: 56, w: 1000, h: 800 };
    expect(contains(stage, { x: 100, y: 100, w: 300, h: 200 })).toBe(true);
    expect(contains(stage, { x: 900, y: 100, w: 300, h: 200 })).toBe(false); // sticks out right
    expect(contains(stage, { x: 64, y: 56, w: 1000, h: 800 })).toBe(true);
  });
  it("probe points are inset corners + centre", () => {
    expect(probePoints({ x: 0, y: 0, w: 100, h: 50 })).toEqual([
      [4, 4],
      [96, 4],
      [4, 46],
      [96, 46],
      [50, 25],
    ]);
  });
});

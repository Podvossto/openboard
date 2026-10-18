import { describe, expect, it } from "vitest";
import { hits, simplify, toPath } from "./geometry";

describe("ink geometry", () => {
  it("simplify drops near-duplicate points but keeps endpoints", () => {
    const p = [0, 0, 0.2, 0.1, 0.4, 0.2, 5, 5, 5.1, 5.1, 10, 10];
    expect(simplify(p, 1.5)).toEqual([0, 0, 5, 5, 10, 10]);
    expect(simplify([1, 2])).toEqual([1, 2]);
  });
  it("toPath builds valid SVG commands", () => {
    expect(toPath([])).toBe("");
    expect(toPath([1, 2])).toBe("M1 2l0.01 0");
    expect(toPath([0, 0, 10, 0])).toBe("M0 0L10 0");
    expect(toPath([0, 0, 10, 0, 10, 10])).toBe("M0 0Q10 0 10 5L10 10");
  });
  it("hit test respects radius + stroke width", () => {
    const line = [0, 0, 100, 0];
    expect(hits(line, 2, 50, 4, 3)).toBe(true);
    expect(hits(line, 2, 50, 10, 3)).toBe(false);
    expect(hits(line, 2, 120, 0, 3)).toBe(false);
    expect(hits([5, 5], 4, 7, 5, 1)).toBe(true);
  });
});

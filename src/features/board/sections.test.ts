import { describe, expect, it } from "vitest";
import { adoptedSection, membersOf, moveMembers, newSectionAt, nextSectionName, sectionAt } from "./sections";
import type { Section } from "../../lib/types";

const s = (id: string, x: number, y: number, w: number, h: number): Section => ({
  id,
  name: id,
  color: "#fff",
  x,
  y,
  width: w,
  height: h,
});

describe("sections", () => {
  const secs = [s("big", 0, 0, 1000, 1000), s("small", 100, 100, 300, 300)];

  it("finds the section containing the center, innermost wins", () => {
    expect(sectionAt({ x: 10, y: 10, width: 100, height: 100 }, secs)).toBe("big");
    expect(sectionAt({ x: 150, y: 150, width: 100, height: 100 }, secs)).toBe("small");
    expect(sectionAt({ x: 2000, y: 0, width: 100, height: 100 }, secs)).toBeUndefined();
  });

  it("uses the center, not the corner", () => {
    // top-left corner outside, center inside
    expect(sectionAt({ x: -40, y: -40, width: 200, height: 200 }, secs)).toBe("big");
    // top-left inside, center outside
    expect(sectionAt({ x: 950, y: 950, width: 200, height: 200 }, secs)).toBeUndefined();
  });

  it("adopt / release", () => {
    expect(adoptedSection({ x: 10, y: 10, width: 10, height: 10 }, secs, undefined)).toBe("big");
    expect(adoptedSection({ x: 5000, y: 10, width: 10, height: 10 }, secs, "big")).toBeUndefined();
    expect(adoptedSection({ x: 10, y: 10, width: 10, height: 10 }, secs, "big")).toBe("big");
  });

  it("moves members by a delta", () => {
    const items = [
      { id: "a", x: 10, y: 20, width: 1, height: 1, section: "big" },
      { id: "b", x: 0, y: 0, width: 1, height: 1 },
    ];
    expect(moveMembers(membersOf(items, "big"), 5, -5)).toEqual([{ id: "a", x: 15, y: 15 }]);
  });

  it("names and creates sections", () => {
    expect(nextSectionName([])).toBe("Section 1");
    expect(nextSectionName([s("x", 0, 0, 1, 1)])).toBe("Section 2");
    const n = newSectionAt("s1", 1000, 500, []);
    expect(n).toMatchObject({ x: 550, y: 200, width: 900, height: 600, name: "Section 1" });
  });
});

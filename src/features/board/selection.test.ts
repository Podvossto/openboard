import { describe, expect, it } from "vitest";
import { summarizeSelection } from "./selection";

describe("summarizeSelection", () => {
  it("counts per kind in a fixed order", () => {
    expect(summarizeSelection([{ type: "tile" }, { type: "console" }, { type: "console" }])).toBe("2 consoles, 1 tile");
    expect(summarizeSelection([{ type: "section" }])).toBe("1 section");
    expect(summarizeSelection([])).toBe("nothing");
  });
});

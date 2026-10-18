import { describe, expect, it } from "vitest";
import { agentColor, barPath, formatTokens, heatLevel, niceCeil, prettyDate, stackOrder } from "./calc";

describe("formatTokens", () => {
  it("compacts large numbers", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(340_123)).toBe("340k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(14_494_686)).toBe("14.5M");
    expect(formatTokens(2_100_000_000)).toBe("2.1B");
  });
});

describe("heatLevel", () => {
  it("maps to 0..4 by share of max", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(30, 100)).toBe(1);
    expect(heatLevel(50, 100)).toBe(2);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(500, 100)).toBe(4);
  });
});

describe("stackOrder / agentColor", () => {
  it("known agents first, rest alphabetical", () => {
    expect(stackOrder({ zeta: 1, claude: 2, alpha: 3, codex: 4 })).toEqual([
      "claude",
      "codex",
      "alpha",
      "zeta",
    ]);
    expect(agentColor("claude")).toBe("#d06e4b");
    expect(agentColor("codex")).toBe("#688aff");
    expect(agentColor("gemini")).toBe("#6c6d7a");
  });
});

describe("niceCeil", () => {
  it("snaps to 1/2/5 steps", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(700_000)).toBe(1e6);
    expect(niceCeil(1_400_000)).toBe(2e6);
    expect(niceCeil(3_800_000)).toBe(5e6);
    expect(niceCeil(6_000_000)).toBe(1e7);
  });
});

describe("barPath", () => {
  it("rounds only the top corners", () => {
    const d = barPath(10, 20, 8, 12, 3);
    expect(d.startsWith("M10,32")).toBe(true); // bottom-left, square
    expect(d).not.toContain("L10,20"); // no straight jump to the very top
  });
});

describe("prettyDate", () => {
  it("formats an ISO day", () => {
    expect(/^[A-Z][a-z]{2} \d{1,2}$/.test(prettyDate("2026-10-18"))).toBe(true);
  });
});

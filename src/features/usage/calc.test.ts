import { describe, expect, it } from "vitest";
import type { DayStats } from "../../lib/types";
import {
  activeDaysLabel,
  favoriteModel,
  formatDuration,
  heatGrid,
  humanTokens,
  mostActiveDay,
  prettyModel,
  resetCaption,
  trimLeadingIdle,
  agentColor, barPath, formatTokens, heatLevel, niceCeil, prettyDate, stackOrder } from "./calc";

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

const day = (date: string, tokens: number, sessions = 0): DayStats => ({
  date,
  byAgent: tokens ? { claude: tokens } : {},
  sessions,
  messages: 0,
});

describe("usage summary stats", () => {
  it("humanTokens", () => {
    expect(humanTokens(22_800_000_000)).toBe("22.8b");
    expect(humanTokens(377_000)).toBe("377k");
    expect(humanTokens(12_400)).toBe("12.4k");
    expect(humanTokens(1_250_000)).toBe("1.3m");
    expect(humanTokens(812)).toBe("812");
    expect(humanTokens(0)).toBe("0");
  });
  it("prettyModel", () => {
    expect(prettyModel("claude-opus-4-5-20251101")).toBe("Opus 4.5");
    expect(prettyModel("claude-sonnet-4-20250514")).toBe("Sonnet 4");
    expect(prettyModel("glm-4.6")).toBe("glm-4.6");
  });
  it("favoriteModel picks the biggest, null when empty", () => {
    expect(favoriteModel({ a: 5, b: 9, c: 9 })).toBe("b");
    expect(favoriteModel({})).toBeNull();
    expect(favoriteModel(undefined)).toBeNull();
    expect(favoriteModel({ a: 0 })).toBeNull();
  });
  it("activeDaysLabel / mostActiveDay", () => {
    const days = [day("2026-10-01", 0), day("2026-10-02", 50), day("2026-10-03", 90), day("2026-10-04", 90)];
    expect(activeDaysLabel(days)).toBe("3/4");
    expect(mostActiveDay(days)).toEqual({ date: "2026-10-03", tokens: 90 });
    expect(mostActiveDay([day("2026-10-01", 0)])).toBeNull();
  });
  it("formatDuration", () => {
    expect(formatDuration(15_120)).toBe("4h 12m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(30 * 3600)).toBe("1d 6h");
  });
  it("trimLeadingIdle", () => {
    const days = [day("2026-10-01", 0), day("2026-10-02", 0), day("2026-10-03", 5)];
    expect(trimLeadingIdle(days).map((d) => d.date)).toEqual(["2026-10-03"]);
    expect(trimLeadingIdle([day("2026-10-01", 0)])).toHaveLength(1);
  });
  it("heatGrid places days on Sunday-first rows with month labels", () => {
    // 2026-10-01 is a Thursday (row 4)
    const days = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(2026, 9, 1 + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return day(iso, i === 3 ? 100 : 0);
    });
    const g = heatGrid(days);
    expect(g.cells).toHaveLength(40);
    expect(g.cells[0]).toMatchObject({ col: 0, row: 4 });
    expect(g.cells[3]!.level).toBe(4);
    expect(g.cells[4]!.level).toBe(0);
    expect(g.months.map((m) => m.label)).toEqual(["Oct", "Nov"]);
    expect(g.weeks).toBe(Math.max(...g.cells.map((c) => c.col)) + 1);
  });
  it("resetCaption: same day vs later date, unknown → null", () => {
    const now = Date.parse("2026-10-19T01:00:00Z");
    expect(resetCaption("2026-10-19T04:09:00Z", now, "UTC")).toBe("Resets 4:09am (UTC)");
    expect(resetCaption("2026-10-23T09:00:00Z", now, "UTC")).toBe("Resets Oct 23 at 9:00am");
    expect(resetCaption(String(Date.parse("2026-10-23T21:30:00Z")), now, "UTC")).toBe("Resets Oct 23 at 9:30pm");
    expect(resetCaption(null, now)).toBeNull();
    expect(resetCaption("garbage", now)).toBeNull();
  });
});

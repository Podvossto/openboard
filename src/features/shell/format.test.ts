import { describe, expect, it } from "vitest";
import { cleanName, formatReset, nextInCycle, nextWorkspaceName, pct, usageLabel, usageLevel, usageTooltip } from "./format";

const w = (p: number) => ({ percent: p, resetsAt: null });

describe("usage", () => {
  it("levels by max percent", () => {
    expect(usageLevel({ session: w(10), weekly: w(59) })).toBe("ok");
    expect(usageLevel({ session: w(10), weekly: w(60) })).toBe("warn");
    expect(usageLevel({ session: w(84), weekly: null })).toBe("warn");
    expect(usageLevel({ session: w(20), weekly: w(85) })).toBe("danger");
  });
  it("labels", () => {
    expect(usageLabel({ session: w(33.6), weekly: w(71) })).toBe("Claude 34% · 71% wk");
    expect(usageLabel({ session: null, weekly: null })).toBe("Claude —");
  });
  it("clamps", () => {
    expect(pct(150)).toBe(100);
    expect(pct(NaN)).toBe(0);
  });
  it("formats reset", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(formatReset({ percent: 1, resetsAt: "2026-01-01T00:45:00Z" }, now)).toBe("resets in 45m");
    expect(formatReset({ percent: 1, resetsAt: "2026-01-01T03:05:00Z" }, now)).toBe("resets in 3h 5m");
    expect(formatReset({ percent: 1, resetsAt: "2026-01-04T00:00:00Z" }, now)).toBe("resets in 3d 0h");
    expect(formatReset(null, now)).toBe("reset unknown");
  });
  it("tooltip with error", () => {
    expect(usageTooltip({ session: null, weekly: null, error: "boom" })).toContain("boom");
  });
});

describe("workspaces", () => {
  it("names", () => {
    expect(nextWorkspaceName([{ name: "Main" }])).toBe("Workspace 2");
    expect(nextWorkspaceName([{ name: "Main" }, { name: "Workspace 3" }])).toBe("Workspace 4");
  });
  it("cleans names", () => {
    expect(cleanName("  x ", "y")).toBe("x");
    expect(cleanName("  ", "y")).toBeNull();
    expect(cleanName("y", "y")).toBeNull();
  });
  it("cycles", () => {
    expect(nextInCycle(["a", "b"], "a")).toBe("b");
    expect(nextInCycle(["a", "b"], "b")).toBe("a");
    expect(nextInCycle(["a", "b"], null)).toBe("a");
    expect(nextInCycle([], "a")).toBeNull();
  });
});

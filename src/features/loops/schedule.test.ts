import { describe, expect, it } from "vitest";
import type { LoopConfig } from "../../lib/types";
import { decide, DEFAULT_LOOP, MIN_GAP_MS } from "./schedule";
import { newSince } from "./diffTail";

const cfg = (p: Partial<LoopConfig>): LoopConfig => ({ ...DEFAULT_LOOP, enabled: true, ...p });
const base = { now: 1_000_000, status: "resting" as const, running: true, newOutput: "" };

describe("loop decide", () => {
  it("does nothing when disabled, stopped, maxed, or empty message", () => {
    expect(decide({ ...DEFAULT_LOOP }, base).fire).toBe(false);
    expect(decide(cfg({}), { ...base, running: false }).fire).toBe(false);
    expect(decide(cfg({ runs: 10, maxRuns: 10 }), { ...base, restingSince: 0 })).toEqual({ fire: false, reason: "max runs reached" });
    expect(decide(cfg({ message: "  " }), { ...base, restingSince: 0 }).fire).toBe(false);
  });
  it("never fires while working or needing the user", () => {
    for (const status of ["working", "needsYou", "starting"] as const)
      expect(decide(cfg({}), { ...base, status, restingSince: 0 }).fire).toBe(false);
  });
  it("idle trigger waits for the threshold", () => {
    const c = cfg({ trigger: { kind: "idle", seconds: 60 } });
    expect(decide(c, { ...base, restingSince: base.now - 30_000 }).fire).toBe(false);
    expect(decide(c, { ...base, restingSince: base.now - 61_000 }).fire).toBe(true);
    expect(decide(c, base).fire).toBe(false); // resting time unknown
  });
  it("interval trigger counts from the last run", () => {
    const c = cfg({ trigger: { kind: "interval", minutes: 5 }, lastRunAt: base.now - 4 * 60_000 });
    expect(decide(c, base).fire).toBe(false);
    expect(decide({ ...c, lastRunAt: base.now - 5 * 60_000 }, base).fire).toBe(true);
    expect(decide({ ...c, lastRunAt: undefined }, base).fire).toBe(true);
  });
  it("output trigger matches case-insensitively, with a minimum gap", () => {
    const c = cfg({ trigger: { kind: "output", match: "Tests FAILED" } });
    expect(decide(c, { ...base, newOutput: "... 2 tests failed ..." }).fire).toBe(true);
    expect(decide(c, { ...base, newOutput: "all good" }).fire).toBe(false);
    expect(decide({ ...c, lastRunAt: base.now - MIN_GAP_MS + 1 }, { ...base, newOutput: "tests failed" }).fire).toBe(false);
  });
});

describe("newSince", () => {
  it("returns appended text, also after the window slides", () => {
    expect(newSince("", "abc")).toBe("abc");
    expect(newSince("abc", "abcdef")).toBe("def");
    const prev = "x".repeat(50) + "TAIL-MARK-" + "y".repeat(300);
    const next = prev.slice(100) + "NEW";
    expect(newSince(prev, next)).toBe("NEW");
    expect(newSince("zzz", "completely different")).toBe("completely different");
  });
});

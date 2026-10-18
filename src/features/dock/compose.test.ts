import { describe, expect, it } from "vitest";
import { applyOverrides, composeMembers } from "./ComposeGroup";

describe("applyOverrides", () => {
  it("applies per-member name/model/account, skipping the lead", () => {
    const base = composeMembers("general", ["claudeCode", "codex"], true);
    const out = applyOverrides(base, { 0: { title: " api ", model: "opus" }, 1: { profile: "p1", title: "  " } }, true);
    expect(out[0]).toEqual({ title: "lead", agent: { kind: "claudeCode" }, lead: true });
    expect(out[1]).toEqual({ title: "api", agent: { kind: "claudeCode" }, model: "opus" });
    expect(out[2]).toEqual({ title: "codex-1", agent: { kind: "codex" }, profile: "p1" });
  });
  it("no overrides = unchanged", () => {
    const base = composeMembers("frontend", ["codex"]);
    expect(applyOverrides(base, {}, false)).toEqual(base);
  });
});

describe("composeMembers", () => {
  it("names members by role and numbers them", () => {
    expect(composeMembers("frontend", ["claudeCode", "codex"])).toEqual([
      { title: "frontend-1", agent: { kind: "claudeCode" } },
      { title: "frontend-2", agent: { kind: "codex" } },
    ]);
  });
  it("general role names by agent", () => {
    expect(composeMembers("general", ["claudeCode", "claudeCode", "custom"]).map((m) => m.title)).toEqual([
      "claude-1",
      "claude-2",
      "shell-1",
    ]);
  });
  it("orchestrated adds a Claude lead first", () => {
    const m = composeMembers("testers", ["codex", "codex"], true);
    expect(m.map((x) => x.title)).toEqual(["lead", "testers-1", "testers-2"]);
    expect(m[0]).toMatchObject({ lead: true, agent: { kind: "claudeCode" } });
    expect(m[1]!.lead).toBeUndefined();
  });
});

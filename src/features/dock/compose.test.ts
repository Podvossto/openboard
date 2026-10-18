import { describe, expect, it } from "vitest";
import { composeMembers } from "./ComposeGroup";

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

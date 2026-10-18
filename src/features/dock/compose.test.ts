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
});

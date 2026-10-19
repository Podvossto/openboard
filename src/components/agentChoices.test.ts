import { describe, expect, it } from "vitest";
import type { CatalogStatus } from "../lib/types";
import { agentChoices, agentKey, filterChoices } from "./agentChoices";

const cat = (id: string, program: string, installed: boolean): CatalogStatus => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  program,
  install: "",
  installed,
  installProgram: null,
  installArgs: [],
  installUrl: null,
});

describe("agentChoices", () => {
  it("orders built-ins, installed, then missing CLIs", () => {
    const l = agentChoices([cat("aider", "aider", false), cat("gemini", "gemini", true)]);
    expect(l.map((c) => c.key)).toEqual(["claudeCode", "codex", "shell", "cli:gemini", "cli:aider"]);
    expect(l[3]!.agent).toEqual({ kind: "custom", program: "gemini" });
  });
  it("agentKey round-trips choices", () => {
    expect(agentKey({ kind: "claudeCode" })).toBe("claudeCode");
    expect(agentKey({ kind: "custom", program: "" })).toBe("shell");
    expect(agentKey({ kind: "custom", program: "gemini" })).toBe("cli:gemini");
  });
  it("filters by label or program", () => {
    const l = agentChoices([cat("gemini", "gemini", true), cat("opencode", "opencode", true)]);
    expect(filterChoices(l, "gem").map((c) => c.key)).toEqual(["cli:gemini"]);
    expect(filterChoices(l, "CLAUDE").map((c) => c.key)).toEqual(["claudeCode"]);
    expect(filterChoices(l, "  ")).toHaveLength(5);
  });
});

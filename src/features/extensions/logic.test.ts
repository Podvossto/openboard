import { describe, expect, it } from "vitest";
import { buildMcpServer, mcpTarget, slugifySkill, validateSkillForm } from "./logic";

describe("skill form", () => {
  it("validates name and description", () => {
    expect(validateSkillForm({ name: "ok-1", description: "d", body: "" })).toBeNull();
    expect(validateSkillForm({ name: "Bad Name", description: "d", body: "" })).toMatch(/Name/);
    expect(validateSkillForm({ name: "../x", description: "d", body: "" })).toMatch(/Name/);
    expect(validateSkillForm({ name: "ok", description: "  ", body: "" })).toMatch(/Description/);
  });
  it("slugifies", () => {
    expect(slugifySkill("  My Cool Skill!! ")).toBe("my-cool-skill");
  });
});

describe("buildMcpServer", () => {
  const base = { name: "ctx", transport: "stdio" as const, target: "", env: [], scope: "user" as const };
  it("splits stdio command and args with quotes", () => {
    const r = buildMcpServer({ ...base, target: 'npx -y "my pkg" --x' }, "claude");
    expect(r.ok && r.server.command).toBe("npx");
    expect(r.ok && r.server.args).toEqual(["-y", "my pkg", "--x"]);
  });
  it("requires command / valid URL", () => {
    expect(buildMcpServer({ ...base, target: " " }, "claude").ok).toBe(false);
    expect(buildMcpServer({ ...base, transport: "http", target: "ftp://x" }, "claude").ok).toBe(false);
    const r = buildMcpServer({ ...base, transport: "http", target: "https://h.io/mcp" }, "claude");
    expect(r.ok && r.server.url).toBe("https://h.io/mcp");
  });
  it("validates env rows and skips blank ones", () => {
    const ok = buildMcpServer({ ...base, target: "x", env: [{ key: "A_B", value: "v" }, { key: "", value: "" }] }, "claude");
    expect(ok.ok && ok.server.env).toEqual([["A_B", "v"]]);
    expect(buildMcpServer({ ...base, target: "x", env: [{ key: "1a", value: "v" }] }, "claude").ok).toBe(false);
  });
  it("rejects bad server name and Codex limits", () => {
    expect(buildMcpServer({ ...base, name: "a b", target: "x" }, "claude").ok).toBe(false);
    expect(buildMcpServer({ ...base, transport: "sse", target: "https://h.io" }, "codex").ok).toBe(false);
    expect(buildMcpServer({ ...base, target: "x", scope: "project" }, "codex").ok).toBe(false);
  });
  it("mcpTarget", () => {
    expect(mcpTarget({ command: "npx", args: ["-y", "p"], url: null })).toBe("npx -y p");
    expect(mcpTarget({ command: null, args: [], url: "https://h" })).toBe("https://h");
  });
});

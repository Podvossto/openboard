import { describe, expect, it } from "vitest";
import { buildMcpServer, mcpTarget, mergeSkills, parseSkillFile, slugifySkill, validateSkillForm } from "./logic";

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

describe("mergeSkills", () => {
  const cl = { cli: "claude" as const, profile: null, label: "Claude Code" };
  const cx = { cli: "codex" as const, profile: null, label: "Codex" };
  const work = { cli: "claude" as const, profile: "p1", label: "Work" };
  const sk = (name: string, description = "d", scope: "user" | "project" = "user", kind: "skill" | "prompt" = "skill") => ({ name, description, scope, path: `/x/${name}`, kind });
  it("dedupes identical skills across sources and lists all sources", () => {
    const m = mergeSkills([
      { source: cl, skills: [sk("a"), sk("b")] },
      { source: work, skills: [sk("a")] },
      { source: cx, skills: [sk("a"), sk("c", "d", "user", "prompt")] },
    ]);
    expect(m.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(m[0]?.sources.map((s) => s.label)).toEqual(["Claude Code", "Work", "Codex"]);
    expect(m[1]?.sources).toHaveLength(1);
  });
  it("keeps skills that differ by description or scope separate", () => {
    const m = mergeSkills([
      { source: cl, skills: [sk("a", "one"), sk("a", "one", "project")] },
      { source: cx, skills: [sk("a", "two")] },
    ]);
    expect(m).toHaveLength(3);
  });
  it("does not duplicate a source", () => {
    const m = mergeSkills([{ source: cl, skills: [sk("a"), sk("a")] }]);
    expect(m[0]?.sources).toHaveLength(1);
  });
  it("handles empty input", () => {
    expect(mergeSkills([])).toEqual([]);
  });
});

describe("parseSkillFile", () => {
  it("reads frontmatter name/description and strips it from the body", () => {
    const r = parseSkillFile("SKILL.md", "---\nname: My Skill\ndescription: \"Does things\"\n---\n\n# Title\nBody\n");
    expect(r).toEqual({ name: "my-skill", description: "Does things", body: "# Title\nBody\n" });
  });
  it("handles CRLF and BOM", () => {
    const r = parseSkillFile("x.md", "\uFEFF---\r\nname: a-b\r\ndescription: D\r\n---\r\nhi");
    expect(r.name).toBe("a-b");
    expect(r.description).toBe("D");
    expect(r.body).toBe("hi");
  });
  it("falls back to filename and first non-heading line", () => {
    const r = parseSkillFile("Code Review Helper.md", "# Heading\n\nReview code carefully.\nMore");
    expect(r.name).toBe("code-review-helper");
    expect(r.description).toBe("Review code carefully.");
    expect(r.body).toBe("# Heading\n\nReview code carefully.\nMore");
  });
  it("uses default description when body is only headings/empty", () => {
    expect(parseSkillFile("a.md", "# Only heading").description).toBe("Imported skill");
    expect(parseSkillFile("a.md", "").description).toBe("Imported skill");
  });
  it("uses filename when frontmatter has no name", () => {
    expect(parseSkillFile("foo_bar.md", "---\ndescription: x\n---\nb").name).toBe("foo-bar");
  });
});

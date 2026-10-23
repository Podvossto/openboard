import { describe, expect, it } from "vitest";
import type { AgentPreset } from "../../lib/types";
import { blankPreset, cleanPreset, consoleFromPreset, extraPrompt, insertSnippet, validatePreset } from "./presets";

const po = (): AgentPreset => ({
  ...blankPreset("p1", 0),
  name: "PO",
  role: "Write user stories.",
  skills: ["prd", "jira"],
  mcp: [{ name: "jira", target: "https://mcp.example/jira" }],
});

describe("presets", () => {
  it("validates name, duplicates and MCP rows", () => {
    expect(validatePreset({ ...po(), name: " " }, [])).toMatch(/name/);
    expect(validatePreset(po(), ["po"])).toMatch(/already exists/);
    expect(validatePreset({ ...po(), mcp: [{ name: "bad name", target: "x" }] }, [])).toMatch(/MCP name/);
    expect(validatePreset({ ...po(), mcp: [{ name: "x", target: "" }] }, [])).toMatch(/needs a command/);
    expect(validatePreset({ ...po(), mcp: [{ name: "openboard", target: "x" }] }, [])).toMatch(/reserved/);
    expect(validatePreset({ ...po(), mcp: [{ name: "", target: "" }] }, [])).toBeNull();
    expect(validatePreset({ ...po(), icon: "data:image/png;base64," + "A".repeat(100_000) }, [])).toMatch(/64 KB/);
    expect(validatePreset(po(), [])).toBeNull();
  });
  it("cleans empty rows and duplicate skills", () => {
    const c = cleanPreset({ ...po(), skills: ["a", " a ", ""], mcp: [{ name: "", target: "" }, { name: " fs ", target: " npx fs " }] });
    expect(c.skills).toEqual(["a"]);
    expect(c.mcp).toEqual([{ name: "fs", target: "npx fs" }]);
  });
  it("makes a console carrying the preset choices", () => {
    const c = consoleFromPreset({ ...po(), profile: "zai", model: "glm-5.3[1m]", lead: true }, "c1", 2);
    expect(c).toMatchObject({ id: "c1", title: "PO-2", preset: "p1", profile: "zai", model: "glm-5.3[1m]", lead: true, agent: { kind: "claudeCode" } });
    expect(consoleFromPreset(po(), "c2", 1).title).toBe("PO");
    expect(consoleFromPreset(po(), "c2", 1)).not.toHaveProperty("lead");
  });
  it("extraPrompt = role + skills + auto-shared memory", () => {
    const ws = { name: "Main", memory: "Use pnpm.", memoryAuto: true };
    const p = extraPrompt({ preset: "p1" }, [po()], ws);
    expect(p).toContain("Your role on this team: PO.\nWrite user stories.");
    expect(p).toContain("Prefer these skills when they apply: prd, jira.");
    expect(p).toContain("Use pnpm.");
    expect(extraPrompt({}, [po()], { ...ws, memoryAuto: false })).toBe("");
    expect(extraPrompt({}, [], ws)).toContain('Shared workspace memory ("Main")');
    expect(extraPrompt({ preset: "gone" }, [po()], { ...ws, memoryAuto: false })).toBe("");
  });
  it("insertSnippet adds spacing around the snippet", () => {
    expect(insertSnippet("", 0, "## A\n")).toEqual({ text: "## A\n", caret: 5 });
    expect(insertSnippet("hello", 5, "## A\n").text).toBe("hello\n\n## A\n");
    expect(insertSnippet("x\n\ny", 3, "S").text).toBe("x\n\nS\ny");
  });
});

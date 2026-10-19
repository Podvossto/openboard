// Agent presets + the extra system prompt a console gets at launch (pure, unit-tested).
import type { AgentKind, AgentPreset, ConsoleNode, Workspace } from "../../lib/types";

export const PRESET_COLORS = ["#8ea2ff", "#5fd4a8", "#f2b45c", "#e57ad8", "#6fc8ff", "#ff8f7a"];
export const MAX_ICON_BYTES = 64 * 1024;
export const MEMORY_MAX = 8000;

export function blankPreset(id: string, n: number): AgentPreset {
  return {
    id,
    name: "",
    icon: "emoji:🤖",
    color: PRESET_COLORS[n % PRESET_COLORS.length]!,
    agent: { kind: "claudeCode" },
    profile: null,
    model: null,
    role: "",
    skills: [],
    mcp: [],
    lead: false,
  };
}

/** null = ok, else the message to show. */
export function validatePreset(p: AgentPreset, taken: string[]): string | null {
  const name = p.name.trim();
  if (!name) return "Give the agent a name";
  if (name.length > 40) return "Name: 40 characters max";
  if (taken.some((t) => t.toLowerCase() === name.toLowerCase())) return `"${name}" already exists`;
  // base64 data URLs are ~4/3 of the file size
  if (p.icon.startsWith("data:") && p.icon.length > MAX_ICON_BYTES * 1.37) return "Icon file is larger than 64 KB";
  for (const m of p.mcp) {
    if (!m.name.trim() && !m.target.trim()) continue;
    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(m.name.trim())) return `MCP name "${m.name}" — letters, digits, - or _`;
    if (m.name.trim() === "agent-board") return "MCP name agent-board is reserved";
    if (!m.target.trim()) return `MCP "${m.name}" needs a command or URL`;
  }
  return null;
}

/** Drop empty MCP rows / blank or duplicate skills; trim text. */
export function cleanPreset(p: AgentPreset): AgentPreset {
  return {
    ...p,
    name: p.name.trim(),
    role: p.role.trim(),
    skills: [...new Set(p.skills.map((s) => s.trim()).filter(Boolean))],
    mcp: p.mcp.map((m) => ({ name: m.name.trim(), target: m.target.trim() })).filter((m) => m.name && m.target),
  };
}

/** The console a preset makes (position/size added by the caller). */
export function consoleFromPreset(p: AgentPreset, id: string, n: number): Omit<ConsoleNode, "x" | "y" | "width" | "height"> {
  const agent: AgentKind = p.agent ?? { kind: "claudeCode" };
  return {
    id,
    title: n > 1 ? `${p.name}-${n}` : p.name,
    agent,
    cwd: "",
    preset: p.id,
    ...(p.profile ? { profile: p.profile } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(p.lead ? { lead: true } : {}),
  };
}

/**
 * Extra system prompt for a Claude console: the preset's role + focus skills, then the
 * workspace memory when auto-share is on. "" when there is nothing to add.
 */
export function extraPrompt(
  c: Pick<ConsoleNode, "preset">,
  presets: AgentPreset[],
  ws: Pick<Workspace, "memory" | "memoryAuto" | "name">,
): string {
  const parts: string[] = [];
  const p = c.preset ? presets.find((x) => x.id === c.preset) : undefined;
  if (p) {
    parts.push(p.role.trim() ? `Your role on this team: ${p.name}.\n${p.role.trim()}` : `Your role on this team: ${p.name}.`);
    if (p.skills.length) parts.push(`Prefer these skills when they apply: ${p.skills.join(", ")}.`);
  }
  const mem = ws.memoryAuto ? ws.memory.trim().slice(0, MEMORY_MAX) : "";
  if (mem) parts.push(`Shared workspace memory ("${ws.name}") — conventions and facts the user wants every agent to know:\n${mem}`);
  return parts.join("\n\n");
}

/** Memory snippets the user can insert with one click. */
export const MEMORY_SNIPPETS: { label: string; text: string }[] = [
  { label: "Conventions", text: "## Conventions\n- Language / framework: \n- Code style: \n- Tests: run `` before you finish\n" },
  { label: "Commands", text: "## Commands\n- Dev server: ``\n- Build: ``\n- Test: ``\n" },
  { label: "Links", text: "## Links\n- Repo: \n- Docs: \n- Staging: \n" },
  { label: "Don'ts", text: "## Don't\n- Don't push to main\n- Don't touch \n" },
];

/** Insert `snippet` at the caret (adds blank lines around it when needed). */
export function insertSnippet(text: string, at: number, snippet: string): { text: string; caret: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const pre = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const post = after && !after.startsWith("\n") ? "\n" : "";
  return { text: before + pre + snippet + post + after, caret: (before + pre + snippet).length };
}

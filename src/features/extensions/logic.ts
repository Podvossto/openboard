import type { AddMcpServer, ExtCli, ExtScope, McpTransport, Skill } from "../../lib/types";
import { parseArgs } from "../settings/args";

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SERVER_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "My Skill!" → "my-skill" (helps the user fix a name). */
export function slugifySkill(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export interface SkillForm {
  name: string;
  description: string;
  body: string;
}

/** null = valid, otherwise the message to show. */
export function validateSkillForm(f: SkillForm): string | null {
  if (!SKILL_NAME_RE.test(f.name)) return "Name: 1-64 chars, a-z 0-9 and '-' only";
  if (!f.description.trim()) return "Description is required (it tells the agent when to use the skill)";
  return null;
}

export interface McpForm {
  name: string;
  transport: McpTransport;
  /** stdio: "npx -y pkg --flag" · http/sse: the URL */
  target: string;
  env: { key: string; value: string }[];
  scope: ExtScope;
}

export type McpBuild = { ok: true; server: AddMcpServer } | { ok: false; error: string };

export function buildMcpServer(f: McpForm, cli: ExtCli): McpBuild {
  const name = f.name.trim();
  if (!SERVER_NAME_RE.test(name)) return { ok: false, error: "Name: letters, digits, '-' or '_'" };
  const target = f.target.trim();
  let command = "";
  let args: string[] = [];
  let url = "";
  if (f.transport === "stdio") {
    const parts = parseArgs(target);
    if (parts.length === 0) return { ok: false, error: "Command is required" };
    command = parts[0]!;
    args = parts.slice(1);
  } else {
    if (!/^https?:\/\/\S+$/i.test(target)) return { ok: false, error: "URL must start with http:// or https://" };
    url = target;
  }
  const env: [string, string][] = [];
  for (const r of f.env) {
    if (!r.key.trim() && !r.value) continue;
    if (!ENV_KEY_RE.test(r.key.trim())) return { ok: false, error: `Invalid env name "${r.key}"` };
    env.push([r.key.trim(), r.value]);
  }
  if (cli === "codex") {
    if (f.transport === "sse") return { ok: false, error: "Codex does not support SSE servers" };
    if (f.scope === "project") return { ok: false, error: "Codex MCP servers are user-wide" };
  }
  return { ok: true, server: { name, transport: f.transport, command, args, url, env, headers: [], scope: f.scope } };
}

export const mcpTarget = (s: { command: string | null; args: string[]; url: string | null }) =>
  s.url ?? [s.command ?? "", ...s.args].join(" ").trim();

// ---------- unified skills list ----------

export interface SkillSource {
  cli: ExtCli;
  profile: string | null;
  label: string;
}

export const sourceKey = (s: { cli: ExtCli; profile: string | null }) => `${s.cli}:${s.profile ?? ""}`;

export interface MergedSkill extends Skill {
  sources: SkillSource[];
}

/** Merge per-source skill lists; identical name+description+scope(+kind) collapse into one entry listing every source. */
export function mergeSkills(results: { source: SkillSource; skills: Skill[] }[]): MergedSkill[] {
  const map = new Map<string, MergedSkill>();
  for (const { source, skills } of results) {
    for (const s of skills) {
      const key = JSON.stringify([s.kind, s.scope, s.name, s.description.trim()]);
      const hit = map.get(key);
      if (!hit) map.set(key, { ...s, sources: [source] });
      else if (!hit.sources.some((x) => sourceKey(x) === sourceKey(source))) hit.sources.push(source);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
}

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** Parse a dropped .md file: optional `---` frontmatter with name:/description:, else derive from filename/first line. */
export function parseSkillFile(filename: string, text: string): ParsedSkillFile {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const fm: Record<string, string> = {};
  let body = src;
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (m) {
    body = src.slice(m[0].length);
    for (const line of (m[1] ?? "").split("\n")) {
      const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) fm[(kv[1] ?? "").toLowerCase()] = unquote(kv[2] ?? "");
    }
  }
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const name = fm.name ? slugifySkill(fm.name) : slugifySkill(base);
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  const description = fm.description || firstLine || "Imported skill";
  return { name, description, body: body.replace(/^\n+/, "") };
}

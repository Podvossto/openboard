import type { AddMcpServer, ExtCli, ExtScope, McpTransport } from "../../lib/types";
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

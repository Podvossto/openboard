// Pure: the list of agents a console can run (unit-tested).
import type { AgentKind, CatalogStatus } from "../lib/types";

export interface AgentChoice {
  key: string;
  label: string;
  agent: AgentKind;
  catalogId?: string;
  installed: boolean;
}

/** Stable key: "claudeCode" | "codex" | "shell" | "cli:<program>". */
export function agentKey(a: AgentKind): string {
  if (a.kind !== "custom") return a.kind;
  return a.program ? `cli:${a.program}` : "shell";
}

/** Built-ins first, then installed catalog CLIs, then the not-installed ones. */
export function agentChoices(catalog: CatalogStatus[]): AgentChoice[] {
  const builtins: AgentChoice[] = [
    { key: "claudeCode", label: "Claude Code", agent: { kind: "claudeCode" }, installed: true },
    { key: "codex", label: "Codex", agent: { kind: "codex" }, installed: true },
    { key: "shell", label: "Shell", agent: { kind: "custom", program: "" }, installed: true },
  ];
  const cat = catalog.map((c) => ({
    key: `cli:${c.program}`,
    label: c.name,
    agent: { kind: "custom" as const, program: c.program },
    catalogId: c.id,
    installed: c.installed,
  }));
  return [...builtins, ...cat.filter((c) => c.installed), ...cat.filter((c) => !c.installed)];
}

/** Case-insensitive match on label or program; empty query = all. */
export function filterChoices(list: AgentChoice[], q: string): AgentChoice[] {
  const t = q.trim().toLowerCase();
  if (!t) return list;
  return list.filter((c) => c.label.toLowerCase().includes(t) || c.key.toLowerCase().includes(t));
}

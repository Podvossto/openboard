import type { AgentKind, ConsoleNode } from "../../lib/types";

/** Last `n` path segments (handles / and \), e.g. "/a/b/c" → "b/c". */
export function shortPath(p: string, n = 2): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return p.startsWith("/") || p.startsWith("\\") ? "/" : "";
  return parts.slice(-n).join("/");
}

/** "just now", "5s ago", "3m ago", "2h ago", "4d ago". */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Can a previous session be resumed? claude needs a session id; codex always; shells never. */
export function canResume(c: Pick<ConsoleNode, "agent" | "agentSession">): boolean {
  return c.agent.kind === "codex" || (c.agent.kind === "claudeCode" && !!c.agentSession);
}

export function agentGlyph(a: AgentKind): string {
  return a.kind === "claudeCode" ? "✻" : a.kind === "codex" ? "◈" : "›_";
}

/** Should the OS be alerted? Only on a transition into needsYou while the window is unfocused. */
export function shouldNotify(prev: string | undefined, next: string, focused: boolean): boolean {
  return next === "needsYou" && prev !== "needsYou" && !focused;
}

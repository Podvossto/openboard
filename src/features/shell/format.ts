import type { Usage, UsageWindow, Workspace } from "../../lib/types";

export type UsageLevel = "ok" | "warn" | "danger";

/** Clamp to an integer 0–100; non-finite → 0. */
export function pct(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** <60 ok, <85 warn, else danger — by the larger of the two windows. */
export function usageLevel(u: Pick<Usage, "session" | "weekly">): UsageLevel {
  const m = Math.max(pct(u.session?.percent), pct(u.weekly?.percent));
  return m < 60 ? "ok" : m < 85 ? "warn" : "danger";
}

export function usageLabel(u: Pick<Usage, "session" | "weekly">, name = "Claude"): string {
  const parts = [`${name} ${u.session ? `${pct(u.session.percent)}%` : "—"}`];
  if (u.weekly) parts.push(`${pct(u.weekly.percent)}% wk`);
  return parts.join(" · ");
}

export function formatReset(w: UsageWindow | null, now = Date.now()): string {
  if (!w || !w.resetsAt) return "reset unknown";
  // ISO (Claude) or epoch-ms digits (Z.ai, Codex)
  const t = /^\d{10,}$/.test(w.resetsAt) ? Number(w.resetsAt) : Date.parse(w.resetsAt);
  if (Number.isNaN(t)) return "reset unknown";
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) return "resets now";
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `resets in ${h}h ${mins % 60}m`;
  return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export function usageTooltip(u: Usage, now = Date.now()): string {
  if (u.error) return `Claude usage unavailable: ${u.error}`;
  return [
    `Session: ${u.session ? pct(u.session.percent) + "%" : "—"} (${formatReset(u.session, now)})`,
    `Weekly: ${u.weekly ? pct(u.weekly.percent) + "%" : "—"} (${formatReset(u.weekly, now)})`,
  ].join("\n");
}

/** "Workspace N" with the first N not already used (starting at count+1). */
export function nextWorkspaceName(existing: Pick<Workspace, "name">[]): string {
  const names = new Set(existing.map((w) => w.name));
  for (let n = existing.length + 1; ; n++) {
    if (!names.has(`Workspace ${n}`)) return `Workspace ${n}`;
  }
}

/** Trimmed rename; empty or unchanged → null (keep old). */
export function cleanName(next: string, prev: string): string | null {
  const t = next.trim().slice(0, 40);
  return t && t !== prev ? t : null;
}

/** Next id after `current` in a cyclic list (first when none/unknown). */
export function nextInCycle(ids: string[], current: string | null): string | null {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  return ids[(i + 1) % ids.length] ?? null;
}

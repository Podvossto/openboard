// Pure helpers for the usage analytics panel (no React — unit-tested).
import type { DayStats } from "../../lib/types";

/** Agent brand colors (validated against the dark surface, dataviz six checks). */
export const AGENT_COLORS: Record<string, string> = {
  claude: "#d06e4b",
  codex: "#688aff",
};
export const OTHER_COLOR = "#6c6d7a";

export function agentColor(agent: string): string {
  return AGENT_COLORS[agent] ?? OTHER_COLOR;
}

/** Fixed stack order: known agents first, then the rest alphabetically. */
export function stackOrder(byAgent: Record<string, number>): string[] {
  const known = ["claude", "codex"].filter((a) => byAgent[a] != null);
  const rest = Object.keys(byAgent)
    .filter((a) => a !== "claude" && a !== "codex")
    .sort();
  return [...known, ...rest];
}

export function dayTotal(d: DayStats): number {
  return Object.values(d.byAgent).reduce((a, b) => a + b, 0);
}

/** 14,494,686 → "14.5M" · 340,123 → "340k" · 812 → "812" */
export function formatTokens(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** Round up to a "nice" axis maximum (1 / 2 / 5 × 10^n). */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * base) return m * base;
  }
  return 10 * base;
}

/** Heat intensity 0 (idle) … 4 (max) — proportional to the busiest cell. */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.round((value / max) * 4)));
}

/** "2026-10-18" → "Oct 18" (local). */
export function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** SVG path for a bar with rounded TOP corners only (square at the baseline). */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

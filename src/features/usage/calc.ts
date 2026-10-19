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

// ---------- usage modal: summary stats (pure) ----------

/** 22_800_000_000 → "22.8b" · 377_000 → "377k" · 1_250_000 → "1.3m" · 812 → "812" (lowercase, like /usage). */
export function humanTokens(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 1e9) return `${trim(n / 1e9)}b`;
  if (n >= 1e6) return `${trim(n / 1e6)}m`;
  if (n >= 1e3) return n >= 1e5 ? `${Math.round(n / 1e3)}k` : `${trim(n / 1e3)}k`;
  return String(Math.max(0, Math.round(n)));
}

/** "claude-opus-4-5-20251101" → "Opus 4.5" · "claude-sonnet-4" → "Sonnet 4" · unknown ids pass through. */
export function prettyModel(id: string): string {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  return `${capitalize(m[1]!)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** Model with the most tokens (ties → alphabetical) or null when none. */
export function favoriteModel(models: Record<string, number> | undefined): string | null {
  const best = Object.entries(models ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : null;
}

/** "137/252" — days with activity over days in the window. */
export function activeDaysLabel(days: DayStats[]): string {
  return `${days.filter((d) => dayTotal(d) > 0).length}/${days.length}`;
}

/** Busiest day by tokens (earliest wins ties) or null. */
export function mostActiveDay(days: DayStats[]): { date: string; tokens: number } | null {
  let best: { date: string; tokens: number } | null = null;
  for (const d of days) {
    const t = dayTotal(d);
    if (t > 0 && (!best || t > best.tokens)) best = { date: d.date, tokens: t };
  }
  return best;
}

/** 15120 → "4h 12m" · 90 → "1m" · 0 → "—" */
export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 30) return "—";
  const mins = Math.round(secs / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Drop leading zero-activity days (the "All time" range starts at the first active day). */
export function trimLeadingIdle(days: DayStats[]): DayStats[] {
  const i = days.findIndex((d) => dayTotal(d) > 0);
  return i <= 0 ? days : days.slice(i);
}

export interface HeatCell {
  col: number;
  row: number;
  date: string;
  tokens: number;
  level: number;
}

/** GitHub-style grid: Sunday-first rows (so Mon/Wed/Fri sit on rows 1/3/5), month labels on the first column of each month. */
export function heatGrid(days: DayStats[]): { weeks: number; cells: HeatCell[]; months: { col: number; label: string }[] } {
  if (days.length === 0) return { weeks: 0, cells: [], months: [] };
  const lead = new Date(`${days[0]!.date}T00:00:00`).getDay();
  const max = Math.max(1, ...days.map(dayTotal));
  const cells: HeatCell[] = [];
  const months: { col: number; label: string }[] = [];
  let lastMonth = -1;
  days.forEach((d, i) => {
    const idx = i + lead;
    const col = Math.floor(idx / 7);
    const tokens = dayTotal(d);
    cells.push({ col, row: idx % 7, date: d.date, tokens, level: heatLevel(tokens, max) });
    const mo = Number(d.date.slice(5, 7)) - 1;
    if (mo !== lastMonth) {
      lastMonth = mo;
      const prev = months.at(-1);
      // skip a label that would collide with the previous one
      if (!prev || col - prev.col >= 3) months.push({ col, label: new Date(2000, mo, 1).toLocaleDateString("en-US", { month: "short" }) });
    }
  });
  return { weeks: Math.floor((days.length - 1 + lead) / 7) + 1, cells, months };
}

function parseResetMs(resetsAt: string | null | undefined): number | null {
  if (!resetsAt) return null;
  const t = /^\d{10,}$/.test(resetsAt) ? Number(resetsAt) : Date.parse(resetsAt);
  return Number.isNaN(t) ? null : t;
}

/** 4:09am style clock, in `tz` (IANA) or local. */
function clock(d: Date, tz?: string): string {
  const s = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  return s.replace(/\s/g, "").toLowerCase();
}

/**
 * Reset caption like /usage: same day as `now` → "Resets 4:09am (UTC)"; otherwise
 * "Resets Oct 23 at 9:00am". Null when the reset time is unknown.
 */
export function resetCaption(resetsAt: string | null | undefined, now = Date.now(), tz?: string): string | null {
  const t = parseResetMs(resetsAt);
  if (t == null) return null;
  const d = new Date(t);
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayKey = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  if (dayKey(d) === dayKey(new Date(now))) return `Resets ${clock(d, tz)} (${zone})`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
  return `Resets ${date} at ${clock(d, tz)}`;
}

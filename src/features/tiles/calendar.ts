// Pure date helpers for the calendar tile (no React) — unit-tested in calendar.test.ts.
// Everything works on "YYYY-MM-DD" strings with UTC math so results never
// depend on the machine's timezone.

export interface Ymd {
  y: number;
  m: number; // 1–12
  d: number;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse "YYYY-MM-DD"; null when malformed or out of range. */
export function fromISO(iso: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const toISO = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const utc = (iso: string) => {
  const p = fromISO(iso)!;
  return Date.UTC(p.y, p.m - 1, p.d);
};

export function addDays(iso: string, n: number): string {
  const t = new Date(utc(iso) + n * 86400000);
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Shift by whole months, clamping the day (2026-01-31 + 1 month → 2026-02-28). */
export function addMonths(iso: string, n: number): string {
  const p = fromISO(iso)!;
  const total = (p.y * 12 + p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toISO(y, m, Math.min(p.d, daysInMonth(y, m)));
}

/** Day of week, Monday = 0 … Sunday = 6. */
export function dow(iso: string): number {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export const isSameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** 42 dates (6 rows × Mon-first weeks) covering the month of `iso`. */
export function monthGrid(iso: string): string[] {
  const p = fromISO(iso)!;
  const start = addDays(toISO(p.y, p.m, 1), -dow(toISO(p.y, p.m, 1)));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The 7 dates (Mon..Sun) of the week containing `iso`. */
export function weekOf(iso: string): string[] {
  const start = addDays(iso, -dow(iso));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "October 2026" */
export function monthLabel(iso: string): string {
  const p = fromISO(iso)!;
  return `${MONTHS[p.m - 1]} ${p.y}`;
}

/** "Thu 15" */
export function dayLabel(iso: string): string {
  const p = fromISO(iso)!;
  return `${WEEKDAYS[dow(iso)]!} ${p.d}`;
}

/** "Thu 15 Oct" */
export function shortLabel(iso: string): string {
  const p = fromISO(iso)!;
  return `${WEEKDAYS[dow(iso)]!} ${p.d} ${MONTHS[p.m - 1]!.slice(0, 3)}`;
}

export function todayISO(): string {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

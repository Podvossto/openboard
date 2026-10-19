// Pure tile logic (no React) — unit-tested in logic.test.ts.
import type { ChecklistItem, KanbanColumn, Tile, TileData, TileKind } from "../../lib/types";
import { todayISO } from "./calendar";

let seq = 0;
/** Local ids for checklist items / kanban cards / calendar events (tiles themselves use backend uuids). */
export const localId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const TILE_META: Record<TileKind, { label: string; w: number; h: number; tint: string }> = {
  note: { label: "Note", w: 320, h: 240, tint: "#f2d45a" },
  checklist: { label: "Checklist", w: 340, h: 320, tint: "#7bd389" },
  kanban: { label: "Kanban", w: 760, h: 420, tint: "#8ea2ff" },
  web: { label: "Web", w: 720, h: 480, tint: "#56d8c9" },
  git: { label: "Git", w: 560, h: 520, tint: "#ff8a5c" },
  code: { label: "Code", w: 520, h: 360, tint: "#c792ea" },
  calendar: { label: "Calendar", w: 560, h: 460, tint: "#e57ad8" },
  image: { label: "Image", w: 420, h: 300, tint: "#6fc8ff" },
};

/** Image tile size: keep the aspect ratio, longest side ≤ max (board px). */
export function fitImage(w: number, h: number, max = 520): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: TILE_META.image.w, h: TILE_META.image.h };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(120, Math.round(w * k)), h: Math.max(90, Math.round(h * k) + 34) };
}

/** Accept only real raster/vector image files (by MIME, then by extension). */
export function isImageFile(f: { type: string; name: string }): boolean {
  if (/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i.test(f.type)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name);
}

/** Web tile device presets ("responsive" fills the tile; others render at exact CSS px). */
export interface DevicePreset {
  id: string;
  label: string;
  /** null = no fixed viewport (responsive / custom) */
  w: number | null;
  h: number | null;
}
export const DEVICES: readonly DevicePreset[] = [
  { id: "responsive", label: "Responsive (fill tile)", w: null, h: null },
  { id: "iphone-se", label: "iPhone SE", w: 375, h: 667 },
  { id: "iphone-15-pro", label: "iPhone 15 Pro", w: 393, h: 852 },
  { id: "pixel-8", label: "Pixel 8", w: 412, h: 915 },
  { id: "ipad-mini", label: "iPad Mini", w: 768, h: 1024 },
  { id: "ipad-pro", label: "iPad Pro", w: 1024, h: 1366 },
  { id: "laptop", label: "Laptop", w: 1366, h: 768 },
  { id: "desktop", label: "Desktop", w: 1920, h: 1080 },
] as const;
/** Web tile zoom choices: "fit" scales to the tile, numbers are fixed factors. */
export const ZOOMS: readonly (number | "fit")[] = ["fit", 0.5, 0.75, 1] as const;

/** Scale that fits a devW×devH device inside a tileW×tileH viewport (never upscales past 1). */
export function fitScale(tileW: number, tileH: number, devW: number, devH: number): number {
  if (tileW <= 0 || tileH <= 0 || devW <= 0 || devH <= 0) return 1;
  return Math.min(1, tileW / devW, tileH / devH);
}

/** Preset id the current device dims still belong to (rotation allowed); "custom" otherwise. */
export function matchPreset(presetId: string | undefined, w: number, h: number): string {
  if (!presetId || presetId === "custom") return "custom";
  if (presetId === "responsive") return "responsive";
  const d = DEVICES.find((x) => x.id === presetId);
  return d && ((d.w === w && d.h === h) || (d.w === h && d.h === w)) ? d.id : "custom";
}

export function defaultData<K extends TileKind>(kind: K): TileData[K] {
  const d: { [P in TileKind]: TileData[P] } = {
    note: { text: "" },
    checklist: { items: [] },
    kanban: {
      columns: [
        { id: localId("col"), name: "To do", cards: [] },
        { id: localId("col"), name: "Doing", cards: [] },
        { id: localId("col"), name: "Done", cards: [] },
      ],
    },
    web: { url: "http://localhost:5173" },
    git: { cwd: "" },
    code: { root: "", path: "" },
    calendar: { events: [], view: "month", cursor: todayISO() },
    image: { src: "" },
  };
  return d[kind];
}

/** "localhost:3000" → "http://localhost:3000"; rejects non-http(s). */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `${/^(localhost|127\.|\[::1\])/i.test(s) ? "http" : "https"}://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------- checklist ----------
export const checklistProgress = (items: ChecklistItem[]) => ({
  done: items.filter((i) => i.done).length,
  total: items.length,
});

/** Turn the checklist into a markdown task list (to send to an agent). */
export const checklistMarkdown = (title: string, items: ChecklistItem[]) =>
  [`# ${title || "Checklist"}`, ...items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`)].join("\n");

// ---------- kanban ----------
/** Move a card to column `toCol` at `index` (index clamped; same-column reorder supported). */
/**
 * Edit one card's title / details (and optionally move it to another column, appended at
 * the end). Stamps updatedAt/updatedBy only when something actually changed.
 */
/** "19 Oct 2026, 10:05" (local time) or "" when unknown. */
export function cardWhen(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function editCard(
  cols: KanbanColumn[],
  cardId: string,
  patch: { text?: string; desc?: string },
  toCol: string | undefined,
  by: { name: string; at: number },
): KanbanColumn[] {
  const from = cols.find((c) => c.cards.some((k) => k.id === cardId));
  const card = from?.cards.find((k) => k.id === cardId);
  if (!from || !card) return cols;
  const text = patch.text?.trim() || card.text;
  const desc = patch.desc === undefined ? card.desc : patch.desc.trim() || undefined;
  const moving = !!toCol && toCol !== from.id && cols.some((c) => c.id === toCol);
  if (text === card.text && desc === card.desc && !moving) return cols;
  const next = { ...card, text, desc, updatedAt: by.at, updatedBy: by.name };
  if (!moving) return cols.map((c) => (c.id === from.id ? { ...c, cards: c.cards.map((k) => (k.id === cardId ? next : k)) } : c));
  return cols.map((c) =>
    c.id === from.id ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) } : c.id === toCol ? { ...c, cards: [...c.cards, next] } : c,
  );
}

export function moveCard(cols: KanbanColumn[], cardId: string, toCol: string, index: number): KanbanColumn[] {
  let card: KanbanColumn["cards"][number] | undefined;
  let fromCol = "";
  let fromIdx = -1;
  for (const c of cols) {
    const i = c.cards.findIndex((k) => k.id === cardId);
    if (i >= 0) {
      card = c.cards[i];
      fromCol = c.id;
      fromIdx = i;
    }
  }
  if (!card || !cols.some((c) => c.id === toCol)) return cols;
  return cols.map((c) => {
    let cards = c.cards;
    if (c.id === fromCol) cards = cards.filter((k) => k.id !== cardId);
    if (c.id === toCol) {
      // moving down inside the same column: the removal shifted indexes by one
      const at = Math.max(0, Math.min(fromCol === toCol && index > fromIdx ? index - 1 : index, cards.length));
      cards = [...cards.slice(0, at), card!, ...cards.slice(at)];
    }
    return cards === c.cards ? c : { ...c, cards };
  });
}

export function newTile<K extends TileKind>(id: string, kind: K, x: number, y: number, title?: string): Tile<K> {
  const m = TILE_META[kind];
  return { id, kind, title: title ?? m.label, x, y, width: m.w, height: m.h, data: defaultData(kind) };
}

/** Short label + color for a porcelain XY code. */
export function changeBadge(code: string): { label: string; tone: "add" | "mod" | "del" | "conf" | "new" } {
  if (code === "??") return { label: "U", tone: "new" };
  if (code.includes("U") || code === "AA" || code === "DD") return { label: "!", tone: "conf" };
  if (code.includes("D")) return { label: "D", tone: "del" };
  if (code.includes("A")) return { label: "A", tone: "add" };
  if (code.includes("R")) return { label: "R", tone: "mod" };
  return { label: "M", tone: "mod" };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlaps = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

/** Nearest spot to `want` (top-left) where a w×h box overlaps nothing in `taken` (spiral search). */
export function freeSpot(want: { x: number; y: number }, w: number, h: number, taken: Rect[], pad = 24): { x: number; y: number } {
  const step = 40;
  for (let ring = 0; ring < 60; ring++) {
    const cands: { x: number; y: number }[] = [];
    if (ring === 0) cands.push(want);
    else
      for (let i = -ring; i <= ring; i++) {
        cands.push({ x: want.x + i * step, y: want.y - ring * step });
        cands.push({ x: want.x + i * step, y: want.y + ring * step });
        if (Math.abs(i) !== ring) {
          cands.push({ x: want.x - ring * step, y: want.y + i * step });
          cands.push({ x: want.x + ring * step, y: want.y + i * step });
        }
      }
    // prefer the candidate closest to `want`
    cands.sort((a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y));
    for (const c of cands) if (!taken.some((t) => overlaps({ ...c, width: w, height: h }, t, pad))) return c;
  }
  return want;
}

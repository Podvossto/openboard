// Pure Section logic. APPROACH: members keep ABSOLUTE board coordinates and carry `section?: id`
// (ungrouped consoles, groups, ungrouped tiles). Consoles/tiles inside a group belong to the
// group, never directly to a section. Section moves shift members by the same delta.
import type { Section } from "../../lib/types";

export const SECTION_W = 900;
export const SECTION_H = 600;
export const SECTION_COLORS = ["#7c9cff", "#5fd4a8", "#f2b45c", "#e57ad8", "#6fd0e8", "#ff8a7a"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** minimal shape of anything that can live in a section */
export interface Member extends Rect {
  id: string;
  section?: string;
}

export function centerOf(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Innermost (smallest-area) section whose frame contains the rect's center, or undefined. */
export function sectionAt(rect: Rect, sections: Section[]): string | undefined {
  const c = centerOf(rect);
  let best: Section | undefined;
  for (const s of sections) {
    if (c.x < s.x || c.x > s.x + s.width || c.y < s.y || c.y > s.y + s.height) continue;
    if (!best || s.width * s.height < best.width * best.height) best = s;
  }
  return best?.id;
}

/** Section id a dropped item should have (drag end): adopt when inside, release when outside. */
export function adoptedSection(rect: Rect, sections: Section[], current?: string): string | undefined {
  const next = sectionAt(rect, sections);
  return next === current ? current : next;
}

/** Members of a section. */
export function membersOf<T extends { section?: string }>(items: T[], sectionId: string): T[] {
  return items.filter((i) => i.section === sectionId);
}

/** Position patches that move every member by (dx, dy). */
export function moveMembers(members: Member[], dx: number, dy: number): { id: string; x: number; y: number }[] {
  return members.map((m) => ({ id: m.id, x: m.x + dx, y: m.y + dy }));
}

/** Next default name: "Section N" with N = max existing trailing number + 1. */
export function nextSectionName(sections: Section[]): string {
  let n = 0;
  for (const s of sections) {
    const m = /^Section (\d+)$/.exec(s.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Section ${Math.max(n, sections.length) + 1}`;
}

export function nextSectionColor(sections: Section[]): string {
  return SECTION_COLORS[sections.length % SECTION_COLORS.length]!;
}

/** Default section centred on a point. */
export function newSectionAt(id: string, cx: number, cy: number, sections: Section[]): Section {
  return {
    id,
    name: nextSectionName(sections),
    color: nextSectionColor(sections),
    x: Math.round(cx - SECTION_W / 2),
    y: Math.round(cy - SECTION_H / 2),
    width: SECTION_W,
    height: SECTION_H,
  };
}

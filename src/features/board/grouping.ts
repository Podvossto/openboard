// Pure grouping math: wrap existing consoles in a new group and convert to relative coords.
import { GAP, GROUP_HEADER, GROUP_PAD, CONSOLE_H, CONSOLE_W } from "../../store/board";
import type { ConsoleNode, Group } from "../../lib/types";

/** absolute board position of a console (children store coords relative to their group) */
export function absolutePosition(c: ConsoleNode, groups: Group[]): { x: number; y: number } {
  const g = c.group ? groups.find((x) => x.id === c.group) : undefined;
  return g ? { x: c.x + g.x, y: c.y + g.y } : { x: c.x, y: c.y };
}

export interface GroupPlan {
  group: { x: number; y: number; width: number; height: number };
  /** new relative x/y per console */
  moves: { id: string; x: number; y: number }[];
}

/** Bounding box of the consoles (+ padding/header) → group frame, plus relative coords. */
export function planGroupFromConsoles(consoles: ConsoleNode[], groups: Group[]): GroupPlan | null {
  if (consoles.length === 0) return null;
  const abs = consoles.map((c) => ({ c, ...absolutePosition(c, groups) }));
  const minX = Math.min(...abs.map((a) => a.x));
  const minY = Math.min(...abs.map((a) => a.y));
  const maxX = Math.max(...abs.map((a) => a.x + a.c.width));
  const maxY = Math.max(...abs.map((a) => a.y + a.c.height));
  const gx = minX - GROUP_PAD;
  const gy = minY - GROUP_PAD - GROUP_HEADER;
  return {
    group: { x: gx, y: gy, width: maxX - minX + GROUP_PAD * 2, height: maxY - minY + GROUP_PAD * 2 + GROUP_HEADER },
    moves: abs.map((a) => ({ id: a.c.id, x: a.x - gx, y: a.y - gy })),
  };
}

/** Empty 2x1 group frame at (x, y). */
export function emptyGroupFrame(x: number, y: number) {
  return {
    x,
    y,
    width: GROUP_PAD * 2 + 2 * CONSOLE_W + GAP,
    height: GROUP_HEADER + GROUP_PAD * 2 + CONSOLE_H,
  };
}

/** Next free slot inside a group (grid, same spacing as groupLayout), relative coords. */
export function nextSlotInGroup(
  members: ConsoleNode[],
  group: Pick<Group, "width">,
  w = CONSOLE_W,
  h = CONSOLE_H,
): { x: number; y: number } {
  const cols = Math.max(1, Math.floor((group.width - GROUP_PAD * 2 + GAP) / (w + GAP)));
  const taken = new Set(
    members.map((c) => `${Math.round((c.x - GROUP_PAD) / (w + GAP))},${Math.round((c.y - GROUP_HEADER - GROUP_PAD) / (h + GAP))}`),
  );
  for (let i = 0; ; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (!taken.has(`${col},${row}`))
      return { x: GROUP_PAD + col * (w + GAP), y: GROUP_HEADER + GROUP_PAD + row * (h + GAP) };
  }
}

/** Height the group needs to hold a console at slot y (so adding grows the frame). */
export function groupHeightFor(slotY: number, h = CONSOLE_H): number {
  return slotY + h + GROUP_PAD;
}

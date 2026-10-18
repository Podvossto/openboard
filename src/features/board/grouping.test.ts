import { describe, expect, it } from "vitest";
import { absolutePosition, emptyGroupFrame, nextSlotInGroup, planGroupFromConsoles } from "./grouping";
import { CONSOLE_H, CONSOLE_W, GAP, GROUP_HEADER, GROUP_PAD } from "../../store/board";
import type { ConsoleNode, Group } from "../../lib/types";

const c = (id: string, x: number, y: number, extra: Partial<ConsoleNode> = {}): ConsoleNode => ({
  id, title: id, agent: { kind: "codex" }, cwd: "", x, y, width: 600, height: 400, ...extra,
});

describe("planGroupFromConsoles", () => {
  it("returns null for nothing", () => expect(planGroupFromConsoles([], [])).toBeNull());

  it("wraps the bounding box and makes coords relative", () => {
    const plan = planGroupFromConsoles([c("a", 100, 100), c("b", 800, 300)], [])!;
    expect(plan.group).toEqual({
      x: 100 - GROUP_PAD,
      y: 100 - GROUP_PAD - GROUP_HEADER,
      width: 1400 - 100 + GROUP_PAD * 2,
      height: 700 - 100 + GROUP_PAD * 2 + GROUP_HEADER,
    });
    expect(plan.moves).toEqual([
      { id: "a", x: GROUP_PAD, y: GROUP_PAD + GROUP_HEADER },
      { id: "b", x: 700 + GROUP_PAD, y: 200 + GROUP_PAD + GROUP_HEADER },
    ]);
  });

  it("uses absolute coords of consoles already in another group", () => {
    const groups: Group[] = [{ id: "g", name: "g", color: "", x: 1000, y: 1000, width: 1, height: 1 }];
    const a = c("a", 10, 20, { group: "g" });
    expect(absolutePosition(a, groups)).toEqual({ x: 1010, y: 1020 });
    expect(planGroupFromConsoles([a], groups)!.moves[0]).toEqual({ id: "a", x: GROUP_PAD, y: GROUP_PAD + GROUP_HEADER });
  });
});

describe("group slots", () => {
  it("empty frame is 2x1", () => {
    const f = emptyGroupFrame(5, 6);
    expect(f.width).toBe(GROUP_PAD * 2 + 2 * CONSOLE_W + GAP);
    expect(f.height).toBe(GROUP_HEADER + GROUP_PAD * 2 + CONSOLE_H);
  });

  it("picks the first free slot, wrapping into rows", () => {
    const f = emptyGroupFrame(0, 0);
    const first = nextSlotInGroup([], f);
    expect(first).toEqual({ x: GROUP_PAD, y: GROUP_HEADER + GROUP_PAD });
    const second = nextSlotInGroup([c("a", first.x, first.y)], f);
    expect(second.x).toBe(GROUP_PAD + CONSOLE_W + GAP);
    const third = nextSlotInGroup([c("a", first.x, first.y), c("b", second.x, second.y)], f);
    expect(third).toEqual({ x: GROUP_PAD, y: GROUP_HEADER + GROUP_PAD + CONSOLE_H + GAP });
  });
});

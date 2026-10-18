import { describe, expect, it } from "vitest";
import type { KanbanColumn } from "../../lib/types";
import { changeBadge, checklistMarkdown, checklistProgress, defaultData, freeSpot, moveCard, newTile, normalizeUrl } from "./logic";

const cols = (): KanbanColumn[] => [
  { id: "a", name: "To do", cards: [{ id: "1", text: "one" }, { id: "2", text: "two" }, { id: "3", text: "three" }] },
  { id: "b", name: "Done", cards: [{ id: "4", text: "four" }] },
];
const ids = (c: KanbanColumn[]) => c.map((x) => x.cards.map((k) => k.id).join(""));

describe("kanban moveCard", () => {
  it("moves across columns at index", () => {
    expect(ids(moveCard(cols(), "2", "b", 0))).toEqual(["13", "24"]);
    expect(ids(moveCard(cols(), "2", "b", 99))).toEqual(["13", "42"]);
  });
  it("reorders inside a column both directions", () => {
    expect(ids(moveCard(cols(), "1", "a", 3))).toEqual(["231", "4"]);
    expect(ids(moveCard(cols(), "3", "a", 0))).toEqual(["312", "4"]);
    expect(ids(moveCard(cols(), "1", "a", 2))).toEqual(["213", "4"]);
  });
  it("ignores unknown card/column", () => {
    const c = cols();
    expect(moveCard(c, "x", "b", 0)).toBe(c);
    expect(moveCard(c, "1", "zzz", 0)).toBe(c);
  });
});

describe("urls", () => {
  it("adds a scheme", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeUrl("127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("http://localhost:5173")).toBe("http://localhost:5173/");
  });
  it("rejects junk and non-web schemes", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("javascript://alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("checklist + tiles + git", () => {
  it("progress and markdown", () => {
    const items = [
      { id: "1", text: "a", done: true },
      { id: "2", text: "b", done: false },
    ];
    expect(checklistProgress(items)).toEqual({ done: 1, total: 2 });
    expect(checklistMarkdown("Ship", items)).toBe("# Ship\n- [x] a\n- [ ] b");
  });
  it("newTile uses per-kind defaults", () => {
    const t = newTile("t1", "kanban", 10, 20);
    expect(t).toMatchObject({ id: "t1", kind: "kanban", title: "Kanban", x: 10, y: 20, width: 760 });
    expect(t.data.columns.map((c) => c.name)).toEqual(["To do", "Doing", "Done"]);
    expect(defaultData("note")).toEqual({ text: "" });
  });
  it("change badges", () => {
    expect(changeBadge("??").tone).toBe("new");
    expect(changeBadge(".M").label).toBe("M");
    expect(changeBadge("D.").tone).toBe("del");
    expect(changeBadge("UU").tone).toBe("conf");
    expect(changeBadge("A.").tone).toBe("add");
  });
});

describe("freeSpot", () => {
  it("keeps the wanted spot when free", () => {
    expect(freeSpot({ x: 0, y: 0 }, 100, 100, [])).toEqual({ x: 0, y: 0 });
  });
  it("moves off an occupied spot and never overlaps", () => {
    const taken = [{ x: 0, y: 0, width: 300, height: 200 }];
    const p = freeSpot({ x: 50, y: 50 }, 100, 100, taken, 10);
    const hit = p.x < 310 && p.x + 110 > 0 && p.y < 210 && p.y + 110 > 0;
    expect(hit).toBe(false);
  });
  it("stacks several adds without overlap", () => {
    const taken: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const p = freeSpot({ x: 0, y: 0 }, 200, 150, taken);
      for (const r of taken) expect(p.x < r.x + r.width + 24 && p.x + 224 > r.x && p.y < r.y + r.height + 24 && p.y + 174 > r.y).toBe(false);
      taken.push({ ...p, width: 200, height: 150 });
    }
  });
});

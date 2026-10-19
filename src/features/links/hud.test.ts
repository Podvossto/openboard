import { describe, expect, it } from "vitest";
import type { ConsoleNode, Tile } from "../../lib/types";
import { buildEdges } from "../board/edges";
import { hudRows } from "./hud";

const c = (id: string, extra: Partial<ConsoleNode> = {}): ConsoleNode => ({ id, title: id, agent: { kind: "claudeCode" }, cwd: "", x: 0, y: 0, width: 1, height: 1, ...extra });
const tile = (id: string, kind: Tile["kind"]): Tile => ({ id, kind, title: `T-${id}`, x: 0, y: 0, width: 1, height: 1, data: { columns: [] } as never });

describe("hudRows", () => {
  it("lists leads with workers and consoles with linked tiles, with counts", () => {
    const consoles = [c("L", { lead: true, group: "g" }), c("a", { group: "g" }), c("b"), c("w", { links: ["k", "gone"] }), c("idle")];
    const flashes = [
      { from: "L", to: "a", kind: "lead", at: 10 },
      { from: "L", to: "a", kind: "lead", at: 30 },
      { from: "w", to: "k", kind: "tile", at: 20 },
    ];
    const rows = hudRows(consoles, [tile("k", "kanban")], { L: ["b"] }, flashes);
    expect(rows.map((r) => r.id)).toEqual(["L", "w"]);
    const L = rows[0]!;
    expect(L.workers.map((w) => [w.id, w.sent, w.last])).toEqual([
      ["b", 0, 0],
      ["a", 2, 30],
    ]);
    expect(rows[1]!.tiles).toEqual([{ id: "k", title: "T-k", kind: "kanban", edits: 1, last: 20 }]);
  });
  it("names teams by group (or lead) and gives each lead a colour; drawn teammates count", () => {
    const consoles = [c("L", { lead: true, group: "g" }), c("M", { lead: true, links: ["x"] }), c("x"), c("a", { group: "g" })];
    const rows = hudRows(consoles, [], {}, [], [{ id: "g", name: "Backend" }]);
    expect(rows.map((r) => [r.id, r.team])).toEqual([
      ["L", "Backend"],
      ["M", "M's team"],
    ]);
    expect(rows[0]!.color).not.toBe(rows[1]!.color);
    expect(rows[1]!.workers.map((w) => w.id)).toEqual(["x"]);
  });
  it("is empty without leads or links", () => {
    expect(hudRows([c("x")], [], {}, [])).toEqual([]);
  });
});

describe("buildEdges — links", () => {
  it("draws lead → teammate team edges the user made", () => {
    const e = buildEdges([c("L", { lead: true, links: ["w"] }), c("w")], [], 0, {}, 6000, []);
    expect(e.map((x) => [x.id, x.data?.kind])).toEqual([["team:L->w", "team"]]);
  });
  it("draws console → tile link edges, active while the agent edits", () => {
    const e = buildEdges([c("w", { links: ["k", "missing"] })], [{ from: "w", to: "k", kind: "tile", at: 100 }], 200, {}, 6000, [tile("k", "kanban")]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ id: "link:w->k", source: "w", target: "k", data: { kind: "link", active: true, color: "#5fd4a8" } });
  });
});

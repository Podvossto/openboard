import { describe, expect, it } from "vitest";
import type { ConsoleNode } from "../../lib/types";
import { buildEdges } from "./edges";
import { floatingPoints } from "./FlowEdge";

const c = (id: string, p: Partial<ConsoleNode> = {}): ConsoleNode => ({
  id, title: id, agent: { kind: "claudeCode" }, cwd: "", x: 0, y: 0, width: 1, height: 1, ...p,
});

describe("buildEdges", () => {
  it("connects a grouped lead to its group members", () => {
    const e = buildEdges([c("L", { lead: true, group: "g" }), c("a", { group: "g" }), c("b", { group: "g" }), c("x")], [], 0, {});
    expect(e.map((x) => `${x.source}>${x.target}`).sort()).toEqual(["L>a", "L>b"]);
    expect(e.every((x) => x.data!.kind === "lead" && !x.data!.active)).toBe(true);
  });
  it("adds consoles the lead has contacted and marks recent sends active", () => {
    const e = buildEdges([c("L", { lead: true }), c("a"), c("b")], [{ from: "L", to: "b", kind: "lead", at: 1000 }], 2000, { L: ["a", "b", "gone"] });
    expect(e.map((x) => [x.target, x.data!.active])).toEqual([["a", false], ["b", true]]);
    expect(buildEdges([c("L", { lead: true }), c("b")], [{ from: "L", to: "b", kind: "lead", at: 0 }], 9000, { L: ["b"] })[0]!.data!.active).toBe(false);
  });
  it("shows recent handoffs only", () => {
    const cs = [c("a"), c("b")];
    expect(buildEdges(cs, [{ from: "a", to: "b", kind: "handoff", at: 0 }], 100, {})[0]!.data!.kind).toBe("handoff");
    expect(buildEdges(cs, [{ from: "a", to: "b", kind: "handoff", at: 0 }], 7000, {})).toEqual([]);
  });
});

describe("floatingPoints", () => {
  const a = { x: 0, y: 0, w: 100, h: 60 };
  it("side by side → right edge to left edge", () => {
    expect(floatingPoints(a, { x: 300, y: 10, w: 100, h: 60 })).toMatchObject({ sx: 100, sy: 30, sp: "right", tx: 300, ty: 40, tp: "left" });
  });
  it("stacked → bottom to top, and reversed", () => {
    expect(floatingPoints(a, { x: 20, y: 200, w: 100, h: 60 })).toMatchObject({ sx: 50, sy: 60, sp: "bottom", tx: 70, ty: 200, tp: "top" });
    expect(floatingPoints({ x: 20, y: 200, w: 100, h: 60 }, a)).toMatchObject({ sp: "top", tp: "bottom", sy: 200, ty: 60 });
  });
});

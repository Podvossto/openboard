import { describe, expect, it } from "vitest";
import { persistableChanges, reconcile, type AppNode } from "./nodes";
import type { ConsoleNode, Group } from "../../lib/types";

const g = (id: string): Group => ({ id, name: id, color: "#fff", x: 100, y: 200, width: 900, height: 600 });

const c = (id: string, x = 0): ConsoleNode => ({
  id,
  title: id,
  agent: { kind: "codex" },
  cwd: "C:/x",
  x,
  y: 0,
  width: 700,
  height: 400,
});

describe("reconcile", () => {
  it("keeps selection/measured and drops removed consoles", () => {
    const prev = reconcile([c("a"), c("b")], [], []);
    prev[0] = { ...prev[0]!, selected: true, measured: { width: 700, height: 400 } };
    const next = reconcile([c("a", 50)], [], prev);
    expect(next).toHaveLength(1);
    expect(next[0]!.selected).toBe(true);
    expect(next[0]!.measured).toEqual({ width: 700, height: 400 });
    expect(next[0]!.position).toEqual({ x: 50, y: 0 });
  });

  it("does not snap a node back while it is being dragged", () => {
    const prev: AppNode[] = reconcile([c("a")], [], []).map((n) => ({
      ...n,
      dragging: true,
      position: { x: 333, y: 7 },
    }));
    expect(reconcile([c("a", 0)], [], prev)[0]!.position).toEqual({ x: 333, y: 7 });
  });
});

describe("reconcile groups", () => {
  it("puts groups before children and sets parentId", () => {
    const child = { ...c("k", 24), group: "g1" };
    const nodes = reconcile([child, c("loose")], [g("g1")], []);
    expect(nodes.map((n) => n.id)).toEqual(["g1", "k", "loose"]);
    expect(nodes[0]!.type).toBe("group");
    expect(nodes[0]!.position).toEqual({ x: 100, y: 200 });
    expect(nodes[1]!.parentId).toBe("g1");
    expect(nodes[1]!.position).toEqual({ x: 24, y: 0 });
    expect(nodes[2]!.parentId).toBeUndefined();
  });

  it("drops parentId for a dangling group reference and when ungrouped", () => {
    const child = { ...c("k"), group: "gone" };
    expect(reconcile([child], [], [])[0]!.parentId).toBeUndefined();
    const prev = reconcile([{ ...c("k"), group: "g1" }], [g("g1")], []);
    const next = reconcile([c("k")], [], prev);
    expect(next).toHaveLength(1);
    expect("parentId" in next[0]!).toBe(false);
  });
});

describe("persistableChanges", () => {
  it("persists only drag end and resize end", () => {
    expect(
      persistableChanges([
        { type: "position", id: "a", position: { x: 1.4, y: 2.6 }, dragging: true },
        { type: "position", id: "a", position: { x: 10.4, y: 20.6 }, dragging: false },
        { type: "dimensions", id: "a", dimensions: { width: 500.2, height: 300 }, resizing: true },
        { type: "dimensions", id: "a", dimensions: { width: 501.7, height: 301 }, resizing: false },
        { type: "dimensions", id: "a", dimensions: { width: 1, height: 1 } },
        { type: "select", id: "a", selected: true },
      ]),
    ).toEqual([
      { id: "a", kind: "console", patch: { x: 10, y: 21 } },
      { id: "a", kind: "console", patch: { width: 502, height: 301 } },
    ]);
  });

  it("tags group changes", () => {
    expect(
      persistableChanges(
        [{ type: "dimensions", id: "g1", dimensions: { width: 800.4, height: 500 }, resizing: false }],
        new Set(["g1"]),
      ),
    ).toEqual([{ id: "g1", kind: "group", patch: { width: 800, height: 500 } }]);
  });
});

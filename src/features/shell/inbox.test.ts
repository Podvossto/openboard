import { describe, expect, it } from "vitest";
import type { Board, ConsoleNode, Status } from "../../lib/types";
import { needsYouItems, trackNeedsSince } from "./inbox";

const c = (id: string): ConsoleNode => ({ id, title: `t-${id}`, agent: { kind: "claudeCode" }, cwd: "", x: 0, y: 0, width: 1, height: 1 });
const board = (two: boolean): Board =>
  ({
    version: 1,
    active: "w1",
    workspaces: [
      { id: "w1", name: "Main", viewport: { x: 0, y: 0, zoom: 1 }, consoles: [c("a"), c("b")], groups: [], memory: "" },
      ...(two ? [{ id: "w2", name: "Research", viewport: { x: 0, y: 0, zoom: 1 }, consoles: [c("x")], groups: [], memory: "" }] : []),
    ],
  }) as unknown as Board;

describe("needsYouItems", () => {
  const st = (m: Record<string, Status>) => (id: string) => m[id] ?? "resting";
  it("lists only needsYou consoles across workspaces, oldest first", () => {
    const items = needsYouItems(board(true), st({ a: "needsYou", b: "working", x: "needsYou" }), { a: 50, x: 10 });
    expect(items.map((i) => [i.id, i.wsId, i.wsName])).toEqual([
      ["x", "w2", "Research"],
      ["a", "w1", "Main"],
    ]);
  });
  it("omits the workspace name with a single workspace", () => {
    expect(needsYouItems(board(false), st({ a: "needsYou" }), {})[0]!.wsName).toBeUndefined();
  });
});

describe("trackNeedsSince", () => {
  it("stamps new entries, keeps old stamps, drops the ones that left", () => {
    const a = trackNeedsSince({}, ["a"], 100);
    expect(a).toEqual({ a: 100 });
    const b = trackNeedsSince(a, ["a", "b"], 200);
    expect(b).toEqual({ a: 100, b: 200 });
    expect(trackNeedsSince(b, ["b"], 300)).toEqual({ b: 200 });
    expect(trackNeedsSince(b, ["a", "b"], 400)).toBe(b); // unchanged → same object (no re-render)
  });
});

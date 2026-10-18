import { describe, expect, it } from "vitest";
import type { GitChange, GitGraph } from "../../lib/types";
import { curvePath, isStaged, laneColor, stagedPaths } from "./gitGraph";

describe("git graph helpers", () => {
  it("isStaged reads the index half of the XY code", () => {
    expect(isStaged(".M")).toBe(false);
    expect(isStaged("M.")).toBe(true);
    expect(isStaged("A.")).toBe(true);
    expect(isStaged("??")).toBe(false);
    expect(isStaged("UU")).toBe(true); // conflicted counts as staged for commit purposes
  });

  it("stagedPaths filters and maps", () => {
    const changes: GitChange[] = [
      { code: ".M", path: "a.ts" },
      { code: "A.", path: "b.ts" },
      { code: "??", path: "c.md" },
    ];
    expect(stagedPaths(changes)).toEqual(["b.ts"]);
  });

  it("laneColor cycles the palette", () => {
    expect(laneColor(0)).toBe(laneColor(6));
    expect(laneColor(1)).not.toBe(laneColor(2));
  });

  it("curvePath is a vertical S-curve through both points", () => {
    expect(curvePath(7, 11, 21, 33)).toBe("M7,11 C7,22 21,22 21,33");
    expect(curvePath(7, 11, 7, 33)).toBe("M7,11 C7,22 7,22 7,33");
  });
});

describe("mock graph shape", () => {
  // mirrors what src/dev/tauri-mock.ts returns; guards the contract the Rust side also honours
  const graph: GitGraph = {
    commits: [
      { hash: "e7f3a91", parents: ["9c2d4f0", "048d070"], subject: "Merge branch 'graph-lanes'", author: "Dev", relTime: "2 minutes ago", refs: ["HEAD -> dev"] },
      { hash: "9c2d4f0", parents: ["048d070"], subject: "feat: lane assignment", author: "Dev", relTime: "1 hour ago", refs: [] },
      { hash: "048d070", parents: [], subject: "feat: AI dispatcher", author: "Dev", relTime: "3 hours ago", refs: ["main"] },
    ],
    lanes: [0, 0, 1],
    edges: [
      { from: 0, to: 0, fromRow: 0, toRow: 1 },
      { from: 0, to: 1, fromRow: 0, toRow: 2 },
      { from: 0, to: 1, fromRow: 1, toRow: 2 },
    ],
    laneCount: 2,
  };

  it("lanes and rows stay in range", () => {
    expect(graph.lanes.length).toBe(graph.commits.length);
    expect(graph.lanes.every((l) => l < graph.laneCount)).toBe(true);
    expect(graph.edges.every((e) => e.from < graph.laneCount && e.to < graph.laneCount)).toBe(true);
    expect(graph.edges.every((e) => e.fromRow < e.toRow)).toBe(true);
  });
});

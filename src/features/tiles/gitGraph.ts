// Pure helpers for the git graph tab (no React) — unit-tested in gitGraph.test.ts.
import type { GitChange } from "../../lib/types";

/** Is this porcelain v2 XY code staged (index half set)? "??" is never staged;
 *  porcelain v2 marks an unused half with "." (v1 used a space). */
export function isStaged(code: string): boolean {
  return code !== "??" && code.length === 2 && code[0] !== " " && code[0] !== ".";
}

/** Files that would go into the next commit. */
export const stagedPaths = (changes: GitChange[]): string[] => changes.filter((c) => isStaged(c.code)).map((c) => c.path);

/** Lane palette (lane index → stroke), matching the board's accent tints. */
export const LANE_COLORS = ["#56d8c9", "#f2d45a", "#b48cff", "#7bd389", "#ff8a7a", "#8ea2ff"];
export const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]!;

export const GRAPH_LANE_W = 14;
export const GRAPH_ROW_H = 22;
/** x centre of a lane / y centre of a row in graph coordinates. */
export const laneX = (lane: number): number => lane * GRAPH_LANE_W + 7;
export const rowY = (row: number): number => row * GRAPH_ROW_H + GRAPH_ROW_H / 2;

/** Smooth vertical S-curve between two points (control points at the mid-height). */
export function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

import { beforeEach, describe, expect, it } from "vitest";
import { agentLabel, nextPosition, statusCounts, useBoard } from "./board";
import type { ConsoleNode } from "../lib/types";

const node = (id: string): ConsoleNode => ({
  id,
  title: id,
  agent: { kind: "claudeCode" },
  cwd: "C:/dev",
  x: 0,
  y: 0,
  width: 720,
  height: 440,
});

describe("board store", () => {
  beforeEach(() => useBoard.setState(useBoard.getInitialState(), true));

  it("adds, patches and removes consoles and bumps revision", () => {
    const s = useBoard.getState();
    s.addConsole(node("a"));
    s.patchConsole("a", { title: "api" });
    expect(useBoard.getState().workspace.consoles[0]?.title).toBe("api");
    useBoard.getState().setRuntime("a", { running: true });
    useBoard.getState().removeConsole("a");
    const after = useBoard.getState();
    expect(after.workspace.consoles).toHaveLength(0);
    expect(after.runtime.a).toBeUndefined();
    expect(after.revision).toBe(3);
  });

  it("runtime changes do not mark the workspace dirty", () => {
    useBoard.getState().setRuntime("x", { status: "working" });
    expect(useBoard.getState().revision).toBe(0);
    expect(useBoard.getState().runtime.x).toEqual({ status: "working", running: false });
  });
});

describe("helpers", () => {
  it("lays out new consoles in a 3-column grid", () => {
    const three = [node("a"), node("b"), node("c")];
    expect(nextPosition([])).toEqual({ x: 0, y: 0 });
    expect(nextPosition(three)).toEqual({ x: 0, y: 472 });
  });

  it("counts statuses", () => {
    expect(
      statusCounts({
        a: { status: "working", running: true },
        b: { status: "needsYou", running: true },
        c: { status: "resting", running: true },
        d: { status: "exited", running: false },
      }),
    ).toEqual({ working: 1, resting: 1, needsYou: 1, stopped: 1 });
  });

  it("labels agents", () => {
    expect(agentLabel({ kind: "custom", program: "pwsh" })).toBe("pwsh");
  });
});

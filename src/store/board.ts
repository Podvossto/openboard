import { create } from "zustand";
import type { AgentKind, ConsoleNode, Status, Viewport, Workspace } from "../lib/types";

export interface Runtime {
  status: Status;
  /** true once the PTY is alive in this app run */
  running: boolean;
  exitCode?: number | null;
}

interface BoardState {
  loaded: boolean;
  workspace: Workspace;
  runtime: Record<string, Runtime>;
  /** bumps on every persisted change → triggers debounced save */
  revision: number;

  hydrate: (ws: Workspace) => void;
  addConsole: (c: ConsoleNode) => void;
  removeConsole: (id: string) => void;
  patchConsole: (id: string, patch: Partial<ConsoleNode>) => void;
  setViewport: (v: Viewport) => void;
  setRuntime: (id: string, patch: Partial<Runtime>) => void;
}

const emptyWs: Workspace = {
  version: 1,
  name: "Main",
  viewport: { x: 0, y: 0, zoom: 1 },
  consoles: [],
};

export const useBoard = create<BoardState>((set) => ({
  loaded: false,
  workspace: emptyWs,
  runtime: {},
  revision: 0,

  hydrate: (ws) => set({ workspace: ws, loaded: true }),
  addConsole: (c) =>
    set((s) => ({
      workspace: { ...s.workspace, consoles: [...s.workspace.consoles, c] },
      revision: s.revision + 1,
    })),
  removeConsole: (id) =>
    set((s) => {
      const runtime = { ...s.runtime };
      delete runtime[id];
      return {
        workspace: { ...s.workspace, consoles: s.workspace.consoles.filter((c) => c.id !== id) },
        runtime,
        revision: s.revision + 1,
      };
    }),
  patchConsole: (id, patch) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        consoles: s.workspace.consoles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
      revision: s.revision + 1,
    })),
  setViewport: (viewport) =>
    set((s) => ({ workspace: { ...s.workspace, viewport }, revision: s.revision + 1 })),
  setRuntime: (id, patch) =>
    set((s) => ({
      runtime: {
        ...s.runtime,
        [id]: { status: "starting", running: false, ...s.runtime[id], ...patch },
      },
    })),
}));

export function agentLabel(a: AgentKind): string {
  switch (a.kind) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "custom":
      return a.program;
  }
}

/** Next free spot so new consoles don't stack exactly on top of each other. */
export function nextPosition(existing: ConsoleNode[], w = 720, h = 440, gap = 32) {
  const cols = 3;
  const i = existing.length;
  return { x: (i % cols) * (w + gap), y: Math.floor(i / cols) * (h + gap) };
}

export function statusCounts(runtime: Record<string, Runtime>) {
  const c = { working: 0, resting: 0, needsYou: 0, stopped: 0 };
  for (const r of Object.values(runtime)) {
    if (!r.running || r.status === "exited") c.stopped++;
    else if (r.status === "working") c.working++;
    else if (r.status === "needsYou") c.needsYou++;
    else c.resting++;
  }
  return c;
}

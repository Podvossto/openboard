// CONTRACT: central zustand store. All features read/write board state ONLY through these
// actions. Runtime (status/running) is NOT persisted; everything in `board` is.
import { create } from "zustand";
import type {
  AgentKind,
  Board,
  ConsoleNode,
  Group,
  HookLogEntry,
  InkStroke,
  Preset,
  Tile,
  Settings,
  Status,
  Viewport,
  Workspace,
} from "../lib/types";

/** Active drawing tool; null = normal board interaction. */
export type InkTool = { mode: "pen" | "eraser"; color: string; width: number };

export interface Runtime {
  status: Status;
  /** PTY alive in this app run */
  running: boolean;
  exitCode?: number | null;
  /** last 30 hook events (diagnostics) */
  hooks?: HookLogEntry[];
}

export const DEFAULT_SETTINGS: Settings = {
  defaultCwd: "",
  defaultAgent: { kind: "claudeCode" },
  shell: "",
  claudeArgs: [],
  codexArgs: [],
  notifyNeedsYou: true,
  blinkNeedsYou: true,
  fontSize: 13,
  showUsage: true,
  autoResume: false,
  profiles: [],
};

export const CONSOLE_W = 680;
export const CONSOLE_H = 420;
export const GAP = 28;
export const GROUP_PAD = 24;
export const GROUP_HEADER = 40;
export const GROUP_COLORS = ["#7c9cff", "#5fd4a8", "#f2b45c", "#e57ad8", "#6fd0e8", "#ff8a7a"];

const emptyBoard = (): Board => ({
  version: 2,
  active: "ws-main",
  workspaces: [{ id: "ws-main", name: "Main", viewport: { x: 0, y: 0, zoom: 1 }, consoles: [], groups: [], memory: "" }],
  presets: [],
});

interface BoardState {
  loaded: boolean;
  board: Board;
  settings: Settings;
  /** what an empty defaultCwd resolves to (display only) */
  resolvedCwd: string;
  runtime: Record<string, Runtime>;
  /** bumps on every persisted change → debounced save */
  revision: number;
  /** console id with keyboard focus (command bar default target) */
  focused: string | null;
  /** id of console whose "…" menu / rename / settings is open */
  ui: {
    settingsOpen: boolean;
    memoryOpen: boolean;
    usageAnalyticsOpen: boolean;
    ink: InkTool | null;
    codeOpen: boolean;
    /** file to open when the Code studio opens (pinned tile double-click) */
    codeTarget: { root: string; path: string } | null;
    /** New-console dialog (Task 7): open with optional flow position / target group */
    addConsole: { pos?: { x: number; y: number }; group?: string } | null;
  };

  hydrate: (b: Board) => void;
  setSettings: (s: Settings, resolvedCwd: string) => void;

  // workspaces
  addWorkspace: (ws: Workspace) => void;
  renameWorkspace: (id: string, name: string) => void;
  removeWorkspace: (id: string) => void;
  setActive: (id: string) => void;
  setViewport: (v: Viewport) => void;
  setMemory: (text: string) => void;

  // consoles (always in the ACTIVE workspace unless noted)
  addConsoles: (c: ConsoleNode[]) => void;
  removeConsole: (id: string) => void;
  patchConsole: (id: string, patch: Partial<ConsoleNode>) => void;

  // tiles (note / checklist / kanban / web / git) — active workspace
  addTile: (t: Tile) => void;
  patchTile: (id: string, patch: Partial<Tile>) => void;
  removeTile: (id: string) => void;

  // ink (active workspace)
  addStroke: (s: InkStroke) => void;
  removeStrokes: (ids: string[]) => void;
  clearInk: () => void;

  // groups
  addGroup: (g: Group) => void;
  patchGroup: (id: string, patch: Partial<Group>) => void;
  /** remove group; its consoles become ungrouped at their absolute position */
  removeGroup: (id: string) => void;

  // presets
  savePreset: (p: Preset) => void;
  removePreset: (id: string) => void;

  // runtime
  setRuntime: (id: string, patch: Partial<Runtime>) => void;
  pushHook: (id: string, event: string) => void;
  setFocused: (id: string | null) => void;
  /** console ids that just received work from a lead (transient glow) */
  pulses: Record<string, number>;
  pulse: (id: string) => void;
  /** recent lead→worker sends / handoffs (drive animated edges) */
  flashes: { from: string; to: string; kind: "lead" | "handoff"; at: number }[];
  /** lead id → console ids it has sent work to (this session) */
  contacted: Record<string, string[]>;
  flash: (from: string, to: string, kind: "lead" | "handoff") => void;
  /** node ids playing their exit animation */
  leaving: Record<string, true>;
  setLeaving: (id: string, on: boolean) => void;
  setUi: (patch: Partial<BoardState["ui"]>) => void;
}

/** immutably update the active workspace */
function withActive(b: Board, f: (w: Workspace) => Workspace): Board {
  return { ...b, workspaces: b.workspaces.map((w) => (w.id === b.active ? f(w) : w)) };
}

export const useBoard = create<BoardState>((set) => ({
  loaded: false,
  board: emptyBoard(),
  settings: DEFAULT_SETTINGS,
  resolvedCwd: "",
  runtime: {},
  revision: 0,
  focused: null,
  ui: { settingsOpen: false, memoryOpen: false, usageAnalyticsOpen: false, ink: null, codeOpen: false, codeTarget: null, addConsole: null },

  hydrate: (board) => set({ board, loaded: true }),
  setSettings: (settings, resolvedCwd) => set({ settings, resolvedCwd }),

  addWorkspace: (ws) =>
    set((s) => ({
      board: { ...s.board, workspaces: [...s.board.workspaces, ws], active: ws.id },
      revision: s.revision + 1,
    })),
  renameWorkspace: (id, name) =>
    set((s) => ({
      board: { ...s.board, workspaces: s.board.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) },
      revision: s.revision + 1,
    })),
  removeWorkspace: (id) =>
    set((s) => {
      if (s.board.workspaces.length <= 1) return s;
      const workspaces = s.board.workspaces.filter((w) => w.id !== id);
      const active = s.board.active === id ? workspaces[0]!.id : s.board.active;
      return { board: { ...s.board, workspaces, active }, revision: s.revision + 1 };
    }),
  setActive: (id) => set((s) => ({ board: { ...s.board, active: id }, revision: s.revision + 1 })),
  setViewport: (viewport) =>
    set((s) => ({ board: withActive(s.board, (w) => ({ ...w, viewport })), revision: s.revision + 1 })),
  setMemory: (memory) =>
    set((s) => ({ board: withActive(s.board, (w) => ({ ...w, memory })), revision: s.revision + 1 })),

  addConsoles: (cs) =>
    set((s) => ({
      board: withActive(s.board, (w) => ({ ...w, consoles: [...w.consoles, ...cs] })),
      revision: s.revision + 1,
    })),
  removeConsole: (id) =>
    set((s) => {
      const runtime = { ...s.runtime };
      delete runtime[id];
      return {
        board: {
          ...s.board,
          workspaces: s.board.workspaces.map((w) => ({ ...w, consoles: w.consoles.filter((c) => c.id !== id) })),
        },
        runtime,
        focused: s.focused === id ? null : s.focused,
        revision: s.revision + 1,
      };
    }),
  patchConsole: (id, patch) =>
    set((s) => ({
      board: {
        ...s.board,
        workspaces: s.board.workspaces.map((w) => ({
          ...w,
          consoles: w.consoles.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      },
      revision: s.revision + 1,
    })),

  addTile: (t) =>
    set((s) => ({ board: withActive(s.board, (w) => ({ ...w, tiles: [...(w.tiles ?? []), t] })), revision: s.revision + 1 })),
  patchTile: (id, patch) =>
    set((s) => ({
      board: withActive(s.board, (w) => ({
        ...w,
        tiles: (w.tiles ?? []).map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)),
      })),
      revision: s.revision + 1,
    })),
  removeTile: (id) =>
    set((s) => ({
      board: withActive(s.board, (w) => ({ ...w, tiles: (w.tiles ?? []).filter((t) => t.id !== id) })),
      revision: s.revision + 1,
    })),

  addStroke: (st) =>
    set((s) => ({ board: withActive(s.board, (w) => ({ ...w, ink: [...(w.ink ?? []), st] })), revision: s.revision + 1 })),
  removeStrokes: (ids) =>
    set((s) => {
      const del = new Set(ids);
      return {
        board: withActive(s.board, (w) => ({ ...w, ink: (w.ink ?? []).filter((x) => !del.has(x.id)) })),
        revision: s.revision + 1,
      };
    }),
  clearInk: () => set((s) => ({ board: withActive(s.board, (w) => ({ ...w, ink: [] })), revision: s.revision + 1 })),

  addGroup: (g) =>
    set((s) => ({ board: withActive(s.board, (w) => ({ ...w, groups: [...w.groups, g] })), revision: s.revision + 1 })),
  patchGroup: (id, patch) =>
    set((s) => ({
      board: withActive(s.board, (w) => ({ ...w, groups: w.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      revision: s.revision + 1,
    })),
  removeGroup: (id) =>
    set((s) => ({
      board: withActive(s.board, (w) => {
        const g = w.groups.find((x) => x.id === id);
        return {
          ...w,
          groups: w.groups.filter((x) => x.id !== id),
          consoles: w.consoles.map((c) =>
            c.group === id && g ? { ...c, group: undefined, x: c.x + g.x, y: c.y + g.y } : c,
          ),
          tiles: (w.tiles ?? []).map((t) =>
            t.group === id && g ? { ...t, group: undefined, x: t.x + g.x, y: t.y + g.y } : t,
          ),
        };
      }),
      revision: s.revision + 1,
    })),

  savePreset: (p) =>
    set((s) => ({
      board: { ...s.board, presets: [...s.board.presets.filter((x) => x.id !== p.id), p] },
      revision: s.revision + 1,
    })),
  removePreset: (id) =>
    set((s) => ({ board: { ...s.board, presets: s.board.presets.filter((x) => x.id !== id) }, revision: s.revision + 1 })),

  setRuntime: (id, patch) =>
    set((s) => ({
      runtime: { ...s.runtime, [id]: { status: "starting", running: false, ...s.runtime[id], ...patch } },
    })),
  pushHook: (id, event) =>
    set((s) => {
      const prev = s.runtime[id] ?? { status: "starting" as Status, running: false };
      const hooks = [...(prev.hooks ?? []), { at: Date.now(), event }].slice(-30);
      return { runtime: { ...s.runtime, [id]: { ...prev, hooks } } };
    }),
  setFocused: (focused) => set({ focused }),
  flashes: [],
  contacted: {},
  flash: (from, to, kind) =>
    set((s) => {
      const now = Date.now();
      const flashes = [...s.flashes.filter((f) => now - f.at < 8000), { from, to, kind, at: now }];
      const prev = s.contacted[from] ?? [];
      const contacted = kind === "lead" && !prev.includes(to) ? { ...s.contacted, [from]: [...prev, to] } : s.contacted;
      return { flashes, contacted };
    }),
  leaving: {},
  setLeaving: (id, on) =>
    set((s) => {
      const leaving = { ...s.leaving };
      if (on) leaving[id] = true;
      else delete leaving[id];
      return { leaving };
    }),
  pulses: {},
  pulse: (id) => {
    const at = Date.now();
    set((s) => ({ pulses: { ...s.pulses, [id]: at } }));
    setTimeout(() => set((s) => (s.pulses[id] === at ? { pulses: { ...s.pulses, [id]: 0 } } : s)), 2400);
  },
  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
}));

// ---------- selectors & pure helpers (unit-tested) ----------

export function activeWorkspace(b: Board): Workspace {
  return b.workspaces.find((w) => w.id === b.active) ?? b.workspaces[0]!;
}

export function agentLabel(a: AgentKind): string {
  switch (a.kind) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "custom":
      return a.program || "Shell";
  }
}

export function agentShort(a: AgentKind): string {
  return a.kind === "claudeCode" ? "claude" : a.kind === "codex" ? "codex" : a.program || "shell";
}

/** Next free grid slot (ungrouped consoles) so new consoles never stack. */
export function nextPosition(existing: ConsoleNode[], w = CONSOLE_W, h = CONSOLE_H, gap = GAP) {
  const loose = existing.filter((c) => !c.group);
  const taken = new Set(loose.map((c) => `${Math.round(c.x / (w + gap))},${Math.round(c.y / (h + gap))}`));
  for (let i = 0; ; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (!taken.has(`${col},${row}`)) return { x: col * (w + gap), y: row * (h + gap) };
  }
}

/** Layout for N consoles inside a new group placed at (gx, gy). */
export function groupLayout(n: number, gx: number, gy: number, w = CONSOLE_W, h = CONSOLE_H) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const slots = Array.from({ length: n }, (_, i) => ({
    x: GROUP_PAD + (i % cols) * (w + GAP),
    y: GROUP_HEADER + GROUP_PAD + Math.floor(i / cols) * (h + GAP),
  }));
  return {
    group: {
      x: gx,
      y: gy,
      width: GROUP_PAD * 2 + cols * w + (cols - 1) * GAP,
      height: GROUP_HEADER + GROUP_PAD * 2 + rows * h + (rows - 1) * GAP,
    },
    slots,
  };
}

/** Bottom-most y of anything on the board — new groups go below it. */
export function boardBottom(ws: Workspace): number {
  const ys = [
    ...ws.consoles.filter((c) => !c.group).map((c) => c.y + c.height),
    ...ws.groups.map((g) => g.y + g.height),
    ...(ws.tiles ?? []).filter((t) => !t.group).map((t) => t.y + t.height),
  ];
  return ys.length ? Math.max(...ys) + GAP * 2 : 0;
}

export function statusCounts(runtime: Record<string, Runtime>, ids?: string[]) {
  const c = { working: 0, resting: 0, needsYou: 0, stopped: 0 };
  const entries = ids ? ids.map((id) => runtime[id]) : Object.values(runtime);
  for (const r of entries) {
    if (!r || !r.running || r.status === "exited") c.stopped++;
    else if (r.status === "working") c.working++;
    else if (r.status === "needsYou") c.needsYou++;
    else c.resting++;
  }
  return c;
}

/** effective status for display (not running → exited) */
export function displayStatus(r: Runtime | undefined): Status {
  return r?.running ? r.status : "exited";
}

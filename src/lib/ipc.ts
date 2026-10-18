// Typed wrappers over Tauri commands — the ONLY place that knows command names.
// CONTRACT: mirrors src-tauri/src/commands.rs. Do not call `invoke` elsewhere.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentKind, Board, Detected, RoutePlan, RouterConsole, Settings, Status, Usage } from "./types";

export interface SpawnArgs {
  id: string;
  agent: AgentKind;
  cwd: string;
  cols: number;
  rows: number;
  agentSession?: string;
  resume: boolean;
  /** run the CLI's own login flow instead of the agent */
  login?: boolean;
}

export interface LoadedSettings {
  settings: Settings;
  resolvedCwd: string;
}

export const ipc = {
  loadBoard: () => invoke<{ board: Board; recoveredFromBackup: number | null }>("load_board"),
  saveBoard: (board: Board) => invoke<void>("save_board", { board }),
  loadSettings: () => invoke<LoadedSettings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<LoadedSettings>("save_settings", { settings }),
  newId: () => invoke<string>("new_id"),
  spawn: (args: SpawnArgs) => invoke<void>("spawn_console", { args }),
  attach: (id: string, onData: (bytes: Uint8Array) => void) => {
    const ch = new Channel<ArrayBuffer>();
    ch.onmessage = (buf) => onData(new Uint8Array(buf));
    return invoke<boolean>("attach_console", { id, onData: ch });
  },
  write: (id: string, data: string) => invoke<void>("write_console", { id, data }),
  resize: (id: string, cols: number, rows: number) =>
    invoke<void>("resize_console", { id, cols, rows }),
  kill: (id: string) => invoke<void>("kill_console", { id }),
  status: (id: string) => invoke<Status | null>("console_status", { id }),
  transcript: (id: string) => invoke<string | null>("console_transcript", { id }),
  detectAgents: () => invoke<Detected>("detect_agents"),
  claudeUsage: () => invoke<Usage>("claude_usage"),
  handoffBrief: (from: string, fromTitle: string, toTitle: string) =>
    invoke<string>("handoff_brief", { from, fromTitle, toTitle }),
  routeInstruction: (instruction: string, consoles: RouterConsole[]) =>
    invoke<RoutePlan>("route_instruction", { instruction, consoles }),
};

export const events = {
  onStatus: (cb: (p: { id: string; status: Status }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; status: Status }>("console://status", (e) => cb(e.payload)),
  onExit: (cb: (p: { id: string; code: number | null }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; code: number | null }>("console://exit", (e) => cb(e.payload)),
  /** every Claude hook call (diagnostics + session-id tracking) */
  onHook: (
    cb: (p: { id: string; event: string; session: string | null }) => void,
  ): Promise<UnlistenFn> =>
    listen<{ id: string; event: string; session: string | null }>("console://hook", (e) =>
      cb(e.payload),
    ),
};

/** Send text to a console as if typed, then Enter. */
export async function submit(id: string, text: string) {
  // bracketed-paste keeps multi-line text as one prompt in TUIs that support it
  const body = text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text;
  await ipc.write(id, body);
  await new Promise((r) => setTimeout(r, 60));
  await ipc.write(id, "\r");
}

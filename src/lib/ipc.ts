// Typed wrappers over Tauri commands — the only place that knows command names.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentKind, Detected, Status, Workspace } from "./types";

export const ipc = {
  loadWorkspace: () =>
    invoke<{ workspace: Workspace; recoveredFromBackup: number | null }>("load_workspace"),
  saveWorkspace: (workspace: Workspace) => invoke<void>("save_workspace", { workspace }),
  newConsoleId: () => invoke<string>("new_console_id"),
  spawn: (args: {
    id: string;
    agent: AgentKind;
    cwd: string;
    cols: number;
    rows: number;
    agentSession?: string;
    resume: boolean;
  }) => invoke<void>("spawn_console", { args }),
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
  detectAgents: () => invoke<Detected>("detect_agents"),
};

export const events = {
  onStatus: (cb: (p: { id: string; status: Status }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; status: Status }>("console://status", (e) => cb(e.payload)),
  onExit: (cb: (p: { id: string; code: number | null }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; code: number | null }>("console://exit", (e) => cb(e.payload)),
  onSession: (cb: (p: { id: string; session: string }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; session: string }>("console://session", (e) => cb(e.payload)),
};

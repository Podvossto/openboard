// Typed wrappers over Tauri commands — the ONLY place that knows command names.
// CONTRACT: mirrors src-tauri/src/commands.rs. Do not call `invoke` elsewhere.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AccountUsage,
  SessionUsage,
  AgentKind,
  Analytics,
  KeyStatus,
  ProviderPreset,
  Board,
  Detected,
  FileContent,
  FsEntry,
  GitAction,
  GitBranch,
  GitGraph,
  GoalVerdict,
  GitStatus,
  RoutePlan,
  RouterConsole,
  Settings,
  Status,
  Usage,
} from "./types";

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
  /** account / provider profile id */
  profile?: string;
  /** orchestrator lead (Claude) */
  lead?: boolean;
  /** per-console model override (--model) */
  model?: string;
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
  loopGoalCheck: (id: string, title: string, goal: string) =>
    invoke<GoalVerdict>("loop_goal_check", { id, title, goal }),
  providerPresets: () => invoke<ProviderPreset[]>("provider_presets"),
  profileKeyStatus: () => invoke<KeyStatus[]>("profile_key_status"),
  setProfileKey: (id: string, key: string) => invoke<void>("set_profile_key", { id, key }),
  deleteProfileKey: (id: string) => invoke<void>("delete_profile_key", { id }),
  syncRoster: (roster: { id: string; title: string; agent: string; group?: string }[]) =>
    invoke<void>("sync_roster", { roster }),
  usageAll: () => invoke<AccountUsage[]>("usage_all"),
  usageAnalytics: (days: number) => invoke<Analytics>("usage_analytics", { days }),
  /** tokens per Claude session id (ids with no log are absent) */
  usageForSessions: (sessionIds: string[]) =>
    invoke<Record<string, SessionUsage>>("usage_for_sessions", { sessionIds }),
  gitStatus: (cwd: string) => invoke<GitStatus>("git_status", { cwd }),
  gitRun: (cwd: string, action: GitAction, message = "") => invoke<string>("git_run", { cwd, action, message }),
  fsList: (root: string, rel: string) => invoke<FsEntry[]>("fs_list", { root, rel }),
  fsRead: (root: string, rel: string) => invoke<FileContent>("fs_read", { root, rel }),
  fsWrite: (root: string, rel: string, text: string) => invoke<void>("fs_write", { root, rel, text }),
  gitStage: (cwd: string, paths: string[]) => invoke<void>("git_stage", { cwd, paths }),
  gitUnstage: (cwd: string, paths: string[]) => invoke<void>("git_unstage", { cwd, paths }),
  /** commits the index as-is — stage paths first with gitStage */
  gitCommit: (cwd: string, message: string) => invoke<string>("git_commit", { cwd, message }),
  gitBranches: (cwd: string) => invoke<GitBranch[]>("git_branches", { cwd }),
  gitCheckout: (cwd: string, branch: string) => invoke<void>("git_checkout", { cwd, branch }),
  gitCreateBranch: (cwd: string, name: string) => invoke<void>("git_create_branch", { cwd, name }),
  gitGraph: (cwd: string, limit = 60) => invoke<GitGraph>("git_graph", { cwd, limit }),
};

export const events = {
  onStatus: (cb: (p: { id: string; status: Status }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; status: Status }>("console://status", (e) => cb(e.payload)),
  onExit: (cb: (p: { id: string; code: number | null }) => void): Promise<UnlistenFn> =>
    listen<{ id: string; code: number | null }>("console://exit", (e) => cb(e.payload)),
  onOrchestratorSpawn: (cb: (p: { from: string; agent: string; title: string; task: string }) => void): Promise<UnlistenFn> =>
    listen<{ from: string; agent: string; title: string; task: string }>("orchestrator://spawn", (e) => cb(e.payload)),
  onOrchestratorSent: (cb: (p: { from: string; to: string }) => void): Promise<UnlistenFn> =>
    listen<{ from: string; to: string }>("orchestrator://sent", (e) => cb(e.payload)),
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

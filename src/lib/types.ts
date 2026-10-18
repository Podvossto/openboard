// Mirrors crates/board-core/src/{model,settings,status,agents,usage}.rs (camelCase serde).
// CONTRACT: shared by all frontend features — change only with care.

export type AgentKind =
  | { kind: "claudeCode" }
  | { kind: "codex" }
  /** program "" = the shell from Settings (resolved by the backend) */
  | { kind: "custom"; program: string; args?: string[] };

export type Status = "starting" | "working" | "resting" | "needsYou" | "exited";

export interface ConsoleNode {
  id: string;
  title: string;
  agent: AgentKind;
  /** "" = Settings default working directory */
  cwd: string;
  /** relative to the group when `group` is set */
  x: number;
  y: number;
  width: number;
  height: number;
  group?: string;
  agentSession?: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Workspace {
  id: string;
  name: string;
  viewport: Viewport;
  consoles: ConsoleNode[];
  groups: Group[];
  memory: string;
}

export interface PresetMember {
  title: string;
  agent: AgentKind;
}

export interface Preset {
  id: string;
  name: string;
  members: PresetMember[];
}

export interface Board {
  version: number;
  active: string;
  workspaces: Workspace[];
  presets: Preset[];
}

export interface Settings {
  defaultCwd: string;
  defaultAgent: AgentKind;
  shell: string;
  claudeArgs: string[];
  codexArgs: string[];
  notifyNeedsYou: boolean;
  blinkNeedsYou: boolean;
  fontSize: number;
  showUsage: boolean;
}

export interface AuthInfo {
  installed: boolean;
  loggedIn: boolean;
  detail: string | null;
}

export interface Detected {
  claude: AuthInfo;
  codex: AuthInfo;
  shell: string;
}

export interface UsageWindow {
  percent: number;
  resetsAt: string | null;
}

export interface Usage {
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  error: string | null;
}

export interface HookLogEntry {
  at: number;
  event: string;
}

/** Console summary sent to the AI dispatcher (board-core::router::RouterConsole). */
export interface RouterConsole {
  id: string;
  title: string;
  agent: string;
  status: string;
  group?: string;
  focused: boolean;
}
/** Dispatcher answer (board-core::router::Plan). */
export type RoutePlan =
  | { action: "send"; targets: string[]; message: string; reason: string }
  | { action: "handoff"; from: string; to: string; reason: string }
  | { action: "none"; reason: string };

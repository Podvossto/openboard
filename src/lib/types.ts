// Mirrors crates/board-core/src/model.rs + status.rs (camelCase serde).

export type AgentKind =
  | { kind: "claudeCode" }
  | { kind: "codex" }
  | { kind: "custom"; program: string; args?: string[] };

export type Status = "starting" | "working" | "resting" | "needsYou" | "exited";

export interface ConsoleNode {
  id: string;
  title: string;
  agent: AgentKind;
  cwd: string;
  x: number;
  y: number;
  width: number;
  height: number;
  agentSession?: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Workspace {
  version: number;
  name: string;
  viewport: Viewport;
  consoles: ConsoleNode[];
}

export interface Detected {
  claude: boolean;
  codex: boolean;
  shell: string;
}

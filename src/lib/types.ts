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
  /** automation loop (off unless enabled by the user) */
  loop?: LoopConfig;
  /** account / provider profile id; undefined = the CLI's default login */
  profile?: string;
  /** orchestrator lead: gets agent-board MCP tools to drive other consoles (Claude only) */
  lead?: boolean;
  /** model override passed as --model (Claude / Codex); undefined = CLI default */
  model?: string;
}

export type LoopTrigger =
  | { kind: "interval"; minutes: number }
  /** fire when the console has been resting this long */
  | { kind: "idle"; seconds: number }
  /** fire when new output contains this text */
  | { kind: "output"; match: string };

export interface LoopConfig {
  enabled: boolean;
  trigger: LoopTrigger;
  /** text submitted to the console each time */
  message: string;
  /** stop after this many runs (0 = no limit) */
  maxRuns: number;
  /** optional: stop when claude -p says this goal is met */
  goal: string;
  runs: number;
  lastRunAt?: number;
  /** why it stopped last time (goal met / max runs / error) */
  stoppedReason?: string;
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

export type TileKind = "note" | "checklist" | "kanban" | "web" | "git" | "code" | "calendar";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}
export interface KanbanCard {
  id: string;
  text: string;
}
export interface KanbanColumn {
  id: string;
  name: string;
  cards: KanbanCard[];
}
export type CalendarView = "month" | "week";
export interface CalEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** optional "HH:MM" */
  time?: string;
  title: string;
  /** chip color (hex) */
  color: string;
}
/** `data` shape per kind (stored as free JSON by the backend). */
export interface TileData {
  note: { text: string; color?: string };
  checklist: { items: ChecklistItem[] };
  kanban: { columns: KanbanColumn[] };
  web: {
    url: string;
    /** device preset id from logic.ts DEVICES ("responsive" = fill the tile) */
    preset?: string;
    /** device viewport in CSS px (rotate = swapped) */
    w?: number;
    h?: number;
    rotated?: boolean;
    /** "fit" (scale to the tile) or a fixed factor (0.5 / 0.75 / 1) */
    zoom?: number | "fit";
  };
  calendar: { events: CalEvent[]; view: CalendarView; cursor: string };
  git: { cwd: string };
  code: { root: string; path: string };
}

export interface Tile<K extends TileKind = TileKind> {
  id: string;
  kind: K;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  group?: string;
  data: TileData[K];
}

export interface Workspace {
  id: string;
  name: string;
  viewport: Viewport;
  consoles: ConsoleNode[];
  groups: Group[];
  memory: string;
  /** may be missing in boards saved before tiles existed */
  tiles?: Tile[];
  /** freehand strokes, board coordinates */
  ink?: InkStroke[];
}

export interface InkStroke {
  id: string;
  color: string;
  width: number;
  /** flat [x0, y0, x1, y1, …] in board coordinates, rounded to 0.1 */
  points: number[];
}

export interface GitChange {
  code: string;
  path: string;
}
export interface GitCommit {
  hash: string;
  subject: string;
  when: string;
}
export interface FsEntry {
  name: string;
  /** relative to the root, "/"-separated */
  path: string;
  isDir: boolean;
  size: number;
}
export interface FileContent {
  text: string;
  truncated: boolean;
  binary: boolean;
}

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  commits: GitCommit[];
  branches: string[];
}
export type GitAction = "pull" | "push" | "commitAll";
export interface GitBranch {
  name: string;
  current: boolean;
}
export interface GitGraphCommit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  relTime: string;
  /** decorations: "HEAD -> dev", "origin/main" … */
  refs: string[];
}
export interface GitLaneEdge {
  /** lane of the child (upper) commit */
  from: number;
  /** lane of the parent (lower) commit */
  to: number;
  fromRow: number;
  toRow: number;
}
export interface GitGraph {
  /** topo-ordered, newest first (same order `lanes` is indexed by) */
  commits: GitGraphCommit[];
  lanes: number[];
  edges: GitLaneEdge[];
  laneCount: number;
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
  /** on app start, relaunch every stopped console with a resumable session */
  autoResume: boolean;
  profiles: Profile[];
}

export type ProfileKind =
  | { type: "subscription" }
  | { type: "provider"; provider: string; baseUrl: string; model: string; smallModel: string };

/** Extra account (own login, isolated config dir) or Anthropic-compatible provider (Z.ai …). */
export interface Profile {
  id: string;
  name: string;
  cli: "claude" | "codex";
  kind: ProfileKind;
  color: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  smallModel: string;
  keyHint: string;
  usage: boolean;
}

export interface KeyStatus {
  id: string;
  hasKey: boolean;
  masked: string | null;
}

export interface AccountUsage {
  id: string;
  name: string;
  provider: string;
  usage: Usage;
}

export interface AuthInfo {
  installed: boolean;
  loggedIn: boolean;
  detail: string | null;
}

export interface CatalogStatus {
  id: string;
  name: string;
  program: string;
  install: string;
  installed: boolean;
}

export interface Detected {
  claude: AuthInfo;
  codex: AuthInfo;
  shell: string;
  /** other agent CLIs and whether they are on PATH */
  catalog: CatalogStatus[];
}

export interface UsageWindow {
  percent: number;
  resetsAt: string | null;
}

export interface UsageModelWindow {
  model: string;
  percent: number;
  resetsAt: string | null;
}

export interface SessionUsage {
  tokens: number;
  messages: number;
  model: string | null;
}

export interface Usage {
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  /** per-model weekly limits (Anthropic opus/sonnet); empty when not reported */
  weeklyModels?: UsageModelWindow[];
  error: string | null;
}

/** Usage analytics from local session logs (board-core::analytics). */
export interface DayStats {
  /** "YYYY-MM-DD", local time */
  date: string;
  /** agent id ("claude", "codex") → tokens */
  byAgent: Record<string, number>;
  sessions: number;
  messages: number;
}

export interface AnalyticsTotals {
  tokens: number;
  sessions: number;
  messages: number;
  activeDays: number;
}

export interface AnalyticsStreaks {
  current: number;
  longest: number;
}

export interface Analytics {
  /** oldest → newest, zero-filled */
  days: DayStats[];
  totals: AnalyticsTotals;
  streaks: AnalyticsStreaks;
  peakDay: { date: string; tokens: number } | null;
  topAgent: { agent: string; tokens: number } | null;
  /** Claude model id → tokens */
  models: Record<string, number>;
  /** longest single session, seconds (0 = unknown) */
  longestSessionSecs: number;
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

export interface GoalVerdict {
  done: boolean;
  reason: string;
}

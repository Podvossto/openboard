// Browser-only Tauri IPC mock for headless UI tests (scripts/ui-smoke.py, `vite --mode mock`).
// Never bundled in real builds. window.__mock.emit(event, payload) simulates backend events. Exposes window.__ipcLog and window.__mock.emit(event, payload).
type Cb = (p: unknown) => void;
const listeners: Record<string, Cb[]> = {};
const callbacks = new Map<number, (d: unknown) => void>();
const channels = new Map<string, number>();
let nextCb = 1;
const enc = new TextEncoder();

let board: unknown = {
  version: 2,
  active: "ws-main",
  workspaces: [
    {
      id: "ws-main", name: "Main", viewport: { x: 40, y: 30, zoom: 0.8 }, memory: "Use pnpm. API on :3000.",
      groups: [{ id: "g1", name: "DOCS", color: "#7c9cff", x: 0, y: 500, width: 1432, height: 532 }],
      consoles: [
        { id: "c1", title: "api", agent: { kind: "claudeCode" }, cwd: "C:/dev/api", x: 0, y: 0, width: 680, height: 420, agentSession: "s1" },
        { id: "c2", title: "web", agent: { kind: "codex" }, cwd: "C:/dev/web", x: 708, y: 0, width: 680, height: 420 },
        { id: "c3", title: "docs-1", agent: { kind: "claudeCode" }, cwd: "", x: 24, y: 64, width: 680, height: 420, group: "g1" },
        { id: "c4", title: "docs-2", agent: { kind: "custom", program: "" }, cwd: "", x: 732, y: 64, width: 680, height: 420, group: "g1" },
      ],
    },
    { id: "ws-2", name: "Research", viewport: { x: 0, y: 0, zoom: 1 }, consoles: [], groups: [], memory: "" },
  ],
  presets: [
    { id: "preset-pair", name: "Pair (Claude + Codex)", members: [{ title: "builder", agent: { kind: "claudeCode" } }, { title: "reviewer", agent: { kind: "codex" } }] },
  ],
};
let settings = {
  defaultCwd: "", defaultAgent: { kind: "claudeCode" }, shell: "", claudeArgs: [], codexArgs: [],
  notifyNeedsYou: true, blinkNeedsYou: true, fontSize: 13, showUsage: true,
};
const running = new Set<string>(["c1", "c3"]);
const log: { cmd: string; args: unknown }[] = [];

/** Deterministic fake usage_analytics for a `days` window (plausible weekday-heavy pattern). */
function mkAnalytics(days: number) {
  const today = new Date();
  const dayStats: {
    date: string;
    byAgent: Record<string, number>;
    sessions: number;
    messages: number;
  }[] = [];
  let tokens = 0, sessions = 0, messages = 0, activeDays = 0, longest = 0, run = 0;
  let peakDay: { date: string; tokens: number } | null = null;
  const agentTotals: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = (d.getDate() * 37 + i * 17) % 101;
    const idle = i > 0 && (d.getDay() === 0 || d.getDay() === 6) && r < 45; // idle weekends
    const claude = idle ? 0 : 18_000 + r * 2_300;
    const codex = idle || r % 4 === 0 ? 0 : 2_400 + r * 170;
    const byAgent: Record<string, number> = {};
    if (claude) byAgent.claude = claude;
    if (codex) byAgent.codex = codex;
    const total = claude + codex;
    const sess = total === 0 ? 0 : 1 + (r % 4);
    const msgs = total === 0 ? 0 : 8 + (r % 40);
    if (total > 0) {
      activeDays++;
      run++;
      longest = Math.max(longest, run);
      if (!peakDay || total > peakDay.tokens) peakDay = { date: iso, tokens: total };
      agentTotals.claude = (agentTotals.claude ?? 0) + claude;
      agentTotals.codex = (agentTotals.codex ?? 0) + codex;
    } else {
      run = 0;
    }
    tokens += total;
    sessions += sess;
    messages += msgs;
    dayStats.push({ date: iso, byAgent, sessions: sess, messages: msgs });
  }
  let current = 0;
  let idx = dayStats.length - 1;
  if (dayStats[idx] && Object.keys(dayStats[idx]!.byAgent).length === 0) idx--;
  while (idx >= 0 && dayStats[idx] && Object.keys(dayStats[idx]!.byAgent).length > 0) {
    current++;
    idx--;
  }
  const top = Object.entries(agentTotals).sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    days: dayStats,
    totals: { tokens, sessions, messages, activeDays },
    streaks: { current, longest },
    peakDay,
    topAgent: top ? { agent: top[0], tokens: top[1] } : null,
  };
}

function emit(event: string, payload: unknown) {
  for (const cb of listeners[event] ?? []) cb({ event, payload, id: 0 });
}
function send(id: string, s: string) {
  const ch = channels.get(id);
  if (ch !== undefined) callbacks.get(ch)?.({ message: enc.encode(s).buffer, index: 0 });
}
const w = window as unknown as Record<string, unknown>;
w.__ipcLog = log;
w.__mock = { emit, send, running, analytics: mkAnalytics };
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
w.__TAURI_INTERNALS__ = {
  transformCallback(cb: (d: unknown) => void) {
    const id = nextCb++;
    callbacks.set(id, cb);
    return id;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(cmd: string, args: Record<string, unknown> = {}) {
    log.push({ cmd, args });
    switch (cmd) {
      case "plugin:event|listen": {
        const ev = args.event as string;
        const handlerId = args.handler as number;
        (listeners[ev] ??= []).push((p) => callbacks.get(handlerId)?.(p));
        return handlerId;
      }
      case "plugin:event|unlisten":
        return null;
      case "load_board":
        return { board, recoveredFromBackup: null };
      case "save_board":
        board = args.board;
        return null;
      case "load_settings":
        return { settings, resolvedCwd: "C:/Users/dev" };
      case "save_settings":
        settings = args.settings as typeof settings;
        return { settings, resolvedCwd: settings.defaultCwd || "C:/Users/dev" };
      case "new_id":
        return crypto.randomUUID();
      case "detect_agents":
        return {
          claude: { installed: true, loggedIn: true, detail: "dev@example.com · pro" },
          codex: { installed: true, loggedIn: false, detail: null },
          shell: "pwsh",
          catalog: [
            { id: "gemini", name: "Gemini CLI", program: "gemini", install: "npm i -g @google/gemini-cli", installed: true },
            { id: "opencode", name: "OpenCode", program: "opencode", install: "npm i -g opencode-ai", installed: true },
            { id: "aider", name: "Aider", program: "aider", install: "pip install aider-install", installed: false },
          ],
        };
      case "sync_roster":
        (window as unknown as { __roster?: unknown }).__roster = args.roster;
        return null;
      case "usage_all":
        return [
          { id: "default-claude", name: "Claude (default)", provider: "anthropic", usage: { session: { percent: 34, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, weekly: { percent: 71, resetsAt: null }, error: null } },
          { id: "default-codex", name: "Codex (default)", provider: "openai", usage: { session: { percent: 12, resetsAt: String(Date.now() + 3 * 3600e3) }, weekly: { percent: 40, resetsAt: null }, error: null } },
          { id: "prof-zai", name: "Z.ai GLM", provider: "zai", usage: { session: { percent: 1, resetsAt: String(Date.now() + 4 * 3600e3) }, weekly: { percent: 1, resetsAt: null }, error: null } },
        ];
      case "provider_presets":
        return [
          { id: "zai", name: "Z.ai (GLM Coding Plan)", baseUrl: "https://api.z.ai/api/anthropic", model: "glm-4.6", smallModel: "glm-4.5-air", keyHint: "z.ai → API Keys", usage: true },
          { id: "kimi", name: "Moonshot Kimi", baseUrl: "https://api.moonshot.ai/anthropic", model: "kimi-k2-turbo-preview", smallModel: "kimi-k2-turbo-preview", keyHint: "", usage: false },
        ];
      case "profile_key_status": {
        const ks = (window as unknown as { __keys?: Record<string, string> }).__keys ?? {};
        return Object.keys(ks).map((id) => ({ id, hasKey: true, masked: "sk-1…abcd" }));
      }
      case "set_profile_key": {
        const w = window as unknown as { __keys?: Record<string, string> };
        w.__keys = { ...(w.__keys ?? {}), [String(args.id)]: "set" };
        return null;
      }
      case "delete_profile_key":
        return null;
      case "claude_usage":
        return { session: { percent: 34, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, weekly: { percent: 71, resetsAt: null }, error: null };
      case "usage_analytics":
        return mkAnalytics(Number(args.days) || 30);
      case "attach_console": {
        const id = args.id as string;
        if (!running.has(id)) return false;
        channels.set(id, (args.onData as { id: number }).id);
        setTimeout(() => {
          send(id, `\x1b[32m✓ attached ${id}\x1b[0m\r\n> `);
          if (id === "c1") emit("console://status", { id, status: "needsYou" });
          if (id === "c3") emit("console://status", { id, status: "working" });
        }, 60);
        return true;
      }
      case "spawn_console": {
        const id = (args.args as { id: string }).id;
        running.add(id);
        return null;
      }
      case "console_status":
        return running.has(args.id as string) ? "resting" : null;
      case "console_transcript":
        return "> build the api\nDone: added /users route. Next: tests.";
      case "route_instruction": {
        const ins = String(args.instruction).toLowerCase();
        const cons = args.consoles as { id: string; title: string; agent: string; status: string; focused: boolean }[];
        const live = cons.filter((c) => c.status !== "exited");
        const codex = live.find((c) => c.agent === "codex");
        const from = live.find((c) => c.focused && c.agent !== "codex") ?? live.find((c) => c.agent === "claude");
        if (ins.includes("pass") && codex && from && codex.id !== from.id)
          return { action: "handoff", from: from.id, to: codex.id, reason: "codex takes over" };
        if (live.length === 0) return { action: "none", reason: "Nothing running." };
        return { action: "send", targets: [live[0]!.id], message: String(args.instruction), reason: "best match" };
      }
      case "loop_goal_check": {
        const n = (window as unknown as { __goalCalls?: number }).__goalCalls ?? 0;
        (window as unknown as { __goalCalls?: number }).__goalCalls = n + 1;
        return n >= 1 ? { done: true, reason: "tests pass" } : { done: false, reason: "not yet" };
      }
      case "git_status":
        return {
          branch: "dev",
          upstream: "origin/dev",
          ahead: 2,
          behind: 0,
          changes: [
            { code: ".M", path: "src/App.tsx" },
            { code: "??", path: "notes.md" },
          ],
          commits: [
            { hash: "048d070", subject: "feat: AI dispatcher", when: "5 minutes ago" },
            { hash: "f6414bd", subject: "feat(ui): Tailwind restyle", when: "1 hour ago" },
          ],
          branches: ["dev", "main"],
        };
      case "git_run":
        return args.action === "commitAll" ? `[dev abc1234] ${String(args.message)}` : "Everything up-to-date";
      case "handoff_brief":
        return "Goal: API. Done: /users route. Next: write tests for /users.";
      case "write_console": {
        const id = args.id as string;
        const d = args.data as string;
        // eslint-disable-next-line no-control-regex
        if (d !== "\r") send(id, d.replace(/\x1b\[20[01]~/g, ""));
        else send(id, "\r\n");
        return null;
      }
      case "kill_console": {
        const id = args.id as string;
        running.delete(id);
        setTimeout(() => emit("console://exit", { id, code: 0 }), 30);
        return null;
      }
      case "resize_console":
        return null;
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return true;
      case "plugin:dialog|open":
        return "C:/dev/picked";
      case "plugin:notification|is_permission_granted":
        return true;
      case "plugin:notification|notify":
      case "plugin:window|request_user_attention":
        return null;
      default:
        console.warn("mock: unhandled", cmd);
        return null;
    }
  },
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  plugins: {},
};
export {};

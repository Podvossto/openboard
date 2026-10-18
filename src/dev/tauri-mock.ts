// Browser-only Tauri IPC mock for headless UI tests (scripts/ui-smoke.py, `vite --mode mock`).
// Never bundled in real builds. Exposes window.__ipcLog and window.__mock.emit(event, payload).
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

function emit(event: string, payload: unknown) {
  for (const cb of listeners[event] ?? []) cb({ event, payload, id: 0 });
}
function send(id: string, s: string) {
  const ch = channels.get(id);
  if (ch !== undefined) callbacks.get(ch)?.({ message: enc.encode(s).buffer, index: 0 });
}
const w = window as unknown as Record<string, unknown>;
w.__ipcLog = log;
w.__mock = { emit, send, running };
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
        };
      case "claude_usage":
        return { session: { percent: 34, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, weekly: { percent: 71, resetsAt: null }, error: null };
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
      case "handoff_brief":
        return "Goal: API. Done: /users route. Next: write tests for /users.";
      case "write_console": {
        const id = args.id as string;
        const d = args.data as string;
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

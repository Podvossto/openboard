// Browser-only Tauri IPC mock for headless UI smoke tests (scripts/ui-smoke.py).
// Loaded via vite `--mode mock`; never bundled in real builds.
type Cb = (p: unknown) => void;
const listeners: Record<string, Cb[]> = {};
const callbacks = new Map<number, (d: unknown) => void>();
let nextCb = 1;
let ws: unknown = {
  version: 1,
  name: "Main",
  viewport: { x: 0, y: 0, zoom: 1 },
  consoles: [
    { id: "c1", title: "api", agent: { kind: "claudeCode" }, cwd: "C:/dev/api", x: 0, y: 0, width: 720, height: 440, agentSession: "s1" },
    { id: "c2", title: "web", agent: { kind: "codex" }, cwd: "C:/dev/web", x: 760, y: 0, width: 720, height: 440 },
  ],
};
const running = new Set<string>(["c1"]);
const log: { cmd: string; args: unknown }[] = [];
(window as unknown as { __ipcLog: typeof log }).__ipcLog = log;

const enc = new TextEncoder();
function emit(event: string, payload: unknown) {
  for (const cb of listeners[event] ?? []) cb({ event, payload, id: 0 });
}

(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => undefined,
};
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
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
      case "load_workspace":
        return { workspace: ws, recoveredFromBackup: null };
      case "save_workspace":
        ws = args.workspace;
        return null;
      case "new_console_id":
        return crypto.randomUUID();
      case "detect_agents":
        return { claude: true, codex: false, shell: "pwsh" };
      case "attach_console": {
        const id = args.id as string;
        if (!running.has(id)) return false;
        const ch = args.onData as { id: number };
        const send = (s: string) => callbacks.get(ch.id)?.({ message: enc.encode(s).buffer, index: 0 });
        setTimeout(() => {
          send(`\x1b[32m✓ attached ${id}\x1b[0m\r\n`);
          emit("console://status", { id, status: "needsYou" });
        }, 50);
        return true;
      }
      case "spawn_console":
        running.add((args.args as { id: string }).id);
        return null;
      case "console_status":
        return running.has(args.id as string) ? "resting" : null;
      case "write_console":
      case "resize_console":
      case "kill_console":
        return null;
      case "plugin:dialog|ask":
        return true;
      case "plugin:dialog|open":
        return "C:/dev/new-proj";
      default:
        console.warn("mock: unhandled", cmd);
        return null;
    }
  },
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  plugins: {},
};
export {};

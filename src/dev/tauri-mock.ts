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
  notifyNeedsYou: true, blinkNeedsYou: true, fontSize: 13, showUsage: true, autoResume: false,
};
const running = new Set<string>(["c1", "c3"]);
const log: { cmd: string; args: unknown }[] = [];

// Fake git repo backing the git tile: 2 branches + a merge of a side lane.
const gitRepo = {
  branch: "dev",
  branches: [
    { name: "dev", current: true },
    { name: "main", current: false },
  ],
  changes: [
    { code: ".M", path: "src/App.tsx" },
    { code: "??", path: "notes.md" },
  ] as { code: string; path: string }[],
  commits: [
    { hash: "e7f3a91", parents: ["9c2d4f0", "048d070"], subject: "Merge branch 'graph-lanes'", author: "Dev", relTime: "2 minutes ago", refs: ["HEAD -> dev"] },
    { hash: "9c2d4f0", parents: ["048d070"], subject: "feat: lane assignment", author: "Dev", relTime: "1 hour ago", refs: [] },
    { hash: "048d070", parents: ["f6414bd"], subject: "feat: AI dispatcher", author: "Dev", relTime: "3 hours ago", refs: ["main"] },
    { hash: "f6414bd", parents: ["3aafe73"], subject: "feat(ui): Tailwind restyle", author: "Dev", relTime: "5 hours ago", refs: [] },
    { hash: "3aafe73", parents: [], subject: "feat(phase-3): tiles + loops", author: "Dev", relTime: "1 day ago", refs: [] },
  ],
};

/** Same lane assignment the Rust side does (crates/board-core/src/git.rs `lanes`). */
function assignLanes(commits: typeof gitRepo.commits) {
  const active: (string | undefined)[] = [];
  const lanes: number[] = [];
  const free = () => {
    const i = active.indexOf(undefined);
    if (i >= 0) return i;
    active.push(undefined);
    return active.length - 1;
  };
  for (const c of commits) {
    const hits = active.map((e, i) => (e === c.hash ? i : -1)).filter((i) => i >= 0);
    const lane = hits.length ? hits[0]! : free();
    lanes.push(lane);
    for (const extra of hits.slice(1)) active[extra] = undefined;
    active[lane] = undefined;
    const [p0, ...rest] = c.parents;
    if (p0 && !active.includes(p0)) active[lane] = p0;
    for (const p of rest) if (!active.includes(p)) active[free()] = p;
  }
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const edges = commits.flatMap((c, i) =>
    c.parents
      .map((p) => index.get(p))
      .filter((j): j is number => j !== undefined)
      .map((j) => ({ from: lanes[i]!, to: lanes[j]!, fromRow: i, toRow: j })),
  );
  return { commits, lanes, edges, laneCount: active.length };
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
          branch: gitRepo.branch,
          upstream: `origin/${gitRepo.branch}`,
          ahead: 2,
          behind: 0,
          changes: gitRepo.changes.map((c) => ({ ...c })),
          commits: gitRepo.commits.slice(0, 8).map((c) => ({ hash: c.hash, subject: c.subject, when: c.relTime })),
          branches: gitRepo.branches.map((b) => b.name),
        };
      case "git_stage":
      case "git_unstage": {
        const stage = cmd === "git_stage";
        for (const p of args.paths as string[]) {
          const c = gitRepo.changes.find((x) => x.path === p);
          if (!c) continue;
          if (stage) c.code = c.code === "??" ? "A." : c.code[1] === "M" ? "M." : c.code;
          else c.code = c.code === "A." ? "??" : c.code[0] === "M" ? ".M" : c.code;
        }
        return null;
      }
      case "git_commit": {
        const staged = gitRepo.changes.filter((c) => c.code !== "??" && c.code[0] !== " " && c.code[0] !== ".");
        if (!staged.length) throw new Error("git: nothing to commit");
        const msg = String(args.message).trim();
        const head = gitRepo.commits[0]!;
        const hash = Math.random().toString(16).slice(2, 9);
        head.refs = head.refs.filter((r) => !r.includes("HEAD ->"));
        gitRepo.commits.unshift({ hash, parents: [head.hash], subject: msg, author: "Dev", relTime: "just now", refs: [`HEAD -> ${gitRepo.branch}`] });
        gitRepo.changes = gitRepo.changes.filter((c) => !staged.includes(c));
        return `[${gitRepo.branch} ${hash}] ${msg}`;
      }
      case "git_branches":
        return gitRepo.branches.map((b) => ({ ...b }));
      case "git_checkout": {
        const b = gitRepo.branches.find((x) => x.name === args.branch);
        if (!b) throw new Error(`git: pathspec '${String(args.branch)}' did not match`);
        for (const x of gitRepo.branches) x.current = x.name === b.name;
        gitRepo.branch = b.name;
        return null;
      }
      case "git_create_branch":
        gitRepo.branches.push({ name: String(args.name), current: false });
        return null;
      case "git_graph":
        return assignLanes(gitRepo.commits.slice(0, (args.limit as number) ?? 60).map((c) => ({ ...c, refs: [...c.refs], parents: [...c.parents] })));
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
      case "plugin:dialog|message":
        // plugin-dialog ask()/confirm() compare the result to the button label
        return String(args.buttons) === "YesNo" ? "Yes" : "Ok";
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

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
    { id: "ws-2", name: "Research", viewport: { x: 0, y: 0, zoom: 1 }, consoles: [], groups: [], sections: [], memory: "" },
  ],
  presets: [
    { id: "preset-pair", name: "Pair (Claude + Codex)", members: [{ title: "builder", agent: { kind: "claudeCode" } }, { title: "reviewer", agent: { kind: "codex" } }] },
  ],
};
let settings = {
  defaultCwd: "", defaultAgent: { kind: "claudeCode" }, shell: "", claudeArgs: [], codexArgs: [],
  notifyNeedsYou: true, blinkNeedsYou: true, fontSize: 13, showUsage: true, autoResume: false,
  // UI tests can seed profiles with an init script (window.__seedProfiles)
  profiles: ((window as unknown as { __seedProfiles?: unknown[] }).__seedProfiles ?? []) as unknown[],
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
    models: { "claude-opus-4-5": Math.round((agentTotals.claude ?? 0) * 0.7), "claude-sonnet-4-5": Math.round((agentTotals.claude ?? 0) * 0.3) },
    longestSessionSecs: 4 * 3600 + 12 * 60,
  };
}

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
// in-memory fake project tree for the Code studio (path → text); window.__fs is inspectable by tests
const fakeFs: Record<string, string> = {
  "package.json": '{\n  "name": "demo-app",\n  "version": "1.0.0"\n}\n',
  "README.md": "# Demo app\n\nA tiny **demo** project.\n",
  "src/main.ts": 'import { greet } from "./util";\n\nconst message: string = "hello mock";\nconsole.log(greet(message));\n',
  "src/util.ts": "export const greet = (s: string) => `hi ${s}`;\n",
  "src/styles/app.css": "body { color: #ececf1; }\n",
  "src/lib/deep/notes.txt": "deep file\n",
  "assets/logo.bin": "\u0000BIN",
};
w.__fs = fakeFs;
const fsBad = (rel: string) => rel.startsWith("/") || rel.startsWith("\\") || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes("..");
function fsList(rel: string) {
  if (fsBad(rel)) throw "io: path escapes the project folder";
  const prefix = rel ? `${rel}/` : "";
  const seen = new Map<string, { name: string; path: string; isDir: boolean; size: number }>();
  for (const [p, text] of Object.entries(fakeFs)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const name = rest.split("/")[0]!;
    const isDir = rest.includes("/");
    if (!seen.has(name)) seen.set(name, { name, path: prefix + name, isDir, size: isDir ? 0 : text.length });
  }
  return [...seen.values()].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

/** Mutable fake skills / MCP servers for the Skills & MCP panel. */
const extSkills: { cli: string; name: string; description: string; scope: "user" | "project"; path: string; kind: "skill" | "prompt" }[] = [
  { cli: "claude", name: "pdf-tools", description: "Extract, merge and fill PDF files", scope: "user", path: "C:/Users/dev/.claude/skills/pdf-tools", kind: "skill" },
  { cli: "claude", name: "code-review", description: "Review a diff for bugs and style", scope: "user", path: "C:/Users/dev/.claude/skills/code-review", kind: "skill" },
  { cli: "claude", name: "deploy-notes", description: "Project release checklist", scope: "project", path: "C:/Users/dev/.claude/skills/deploy-notes", kind: "skill" },
  { cli: "codex", name: "review", description: "Review the current changes", scope: "user", path: "C:/Users/dev/.codex/prompts/review.md", kind: "prompt" },
];
const extMcp: { cli: string; name: string; transport: string; command: string | null; args: string[]; url: string | null; envKeys: string[]; headerKeys: string[]; scope: "user" | "project"; source: string }[] = [
  { cli: "claude", name: "context7", transport: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"], url: null, envKeys: ["API_KEY"], headerKeys: [], scope: "user", source: "C:/Users/dev/.claude.json" },
  { cli: "claude", name: "linear", transport: "http", command: null, args: [], url: "https://mcp.linear.app/mcp", envKeys: [], headerKeys: ["Authorization"], scope: "user", source: "C:/Users/dev/.claude.json" },
  { cli: "claude", name: "local-db", transport: "stdio", command: "node", args: ["db.js"], url: null, envKeys: [], headerKeys: [], scope: "project", source: "C:/Users/dev/proj/.mcp.json" },
  { cli: "codex", name: "docs", transport: "stdio", command: "npx", args: ["-y", "docs-mcp"], url: null, envKeys: [], headerKeys: [], scope: "user", source: "C:/Users/dev/.codex/config.toml" },
];
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
            { id: "gemini", name: "Gemini CLI", program: "gemini", install: "npm i -g @google/gemini-cli", installed: true, installProgram: "cmd", installArgs: ["/C", "npm i -g @google/gemini-cli"], installUrl: null },
            { id: "opencode", name: "OpenCode", program: "opencode", install: "npm i -g opencode-ai", installed: true, installProgram: "cmd", installArgs: ["/C", "npm i -g opencode-ai"], installUrl: null },
            { id: "aider", name: "Aider", program: "aider", install: "pip install aider-install", installed: false, installProgram: "cmd", installArgs: ["/C", "pip install aider-install && aider-install"], installUrl: null },
            { id: "qwen", name: "Qwen Code", program: "qwen", install: "npm i -g @qwen-code/qwen-code", installed: (window as unknown as { __qwenInstalled?: boolean }).__qwenInstalled ?? false, installProgram: "cmd", installArgs: ["/C", "npm i -g @qwen-code/qwen-code"], installUrl: null },
            { id: "cursor", name: "Cursor CLI", program: "cursor-agent", install: "see cursor.com/cli", installed: false, installProgram: null, installArgs: [], installUrl: "https://cursor.com/cli" },
          ],
        };
      case "sync_roster":
        (window as unknown as { __roster?: unknown }).__roster = args.roster;
        return null;
      case "usage_all":
        return [
          { id: "default-claude", name: "Claude (default)", provider: "anthropic", usage: { session: { percent: 34, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() }, weekly: { percent: 71, resetsAt: new Date(Date.now() + 3 * 86400e3).toISOString() }, weeklyModels: [{ model: "Sonnet", percent: 17, resetsAt: new Date(Date.now() + 3 * 86400e3).toISOString() }], error: null } },
          { id: "default-codex", name: "Codex (default)", provider: "openai", usage: { session: { percent: 12, resetsAt: String(Date.now() + 3 * 3600e3) }, weekly: { percent: 40, resetsAt: null }, error: null } },
          { id: "prof-zai", name: "Z.ai GLM", provider: "zai", usage: { session: { percent: 1, resetsAt: String(Date.now() + 4 * 3600e3) }, weekly: { percent: 1, resetsAt: null }, error: null } },
        ];
      case "provider_presets":
        return [
          { id: "zai", name: "Z.ai (GLM Coding Plan)", baseUrl: "https://api.z.ai/api/anthropic", model: "glm-5.3[1m]", smallModel: "glm-5.3-flash[1m]", keyHint: "z.ai → API Keys", usage: true, models: ["glm-5.3[1m]", "glm-5.3-flash[1m]"], contextWindow: 1000000 },
          { id: "kimi", name: "Moonshot Kimi", baseUrl: "https://api.moonshot.ai/anthropic", model: "kimi-k2-turbo-preview", smallModel: "kimi-k2-turbo-preview", keyHint: "", usage: false, models: ["kimi-k2-turbo-preview"], contextWindow: 0 },
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
      case "app_version":
        return "0.1.0";
      case "update_check": {
        // window.__update: null = up to date; "fail" = unreachable; else an UpdateInfo
        const u = (window as unknown as { __update?: unknown }).__update;
        if (u === "fail") throw "update: error sending request for url (http://updates.example.invalid:8740/agent-board/latest.json)";
        return u ?? null;
      }
      case "update_install": {
        for (const d of [400_000, 1_200_000, 2_000_000]) {
          await new Promise((r) => setTimeout(r, 120));
          emit("updater://progress", { downloaded: d, total: 2_000_000 });
        }
        (window as unknown as { __installed?: boolean }).__installed = true;
        return null;
      }
      case "list_skills": {
        const cli = String(args.cli);
        return extSkills.filter((x) => x.cli === cli && (x.scope === "user" || args.cwd)).map((x) => ({ ...x, cli: undefined }));
      }
      case "create_skill": {
        const cli = String(args.cli);
        const name = String(args.name);
        if (extSkills.some((x) => x.cli === cli && x.scope === args.scope && x.name === name)) throw `pty: skill "${name}" already exists`;
        extSkills.push({ cli, name, description: String(args.description), scope: args.scope as "user" | "project", path: `C:/Users/dev/.${cli}/skills/${name}`, kind: "skill" });
        return { name, description: String(args.description), scope: args.scope, path: `C:/Users/dev/.${cli}/skills/${name}`, kind: "skill" };
      }
      case "delete_skill": {
        const i = extSkills.findIndex((x) => x.cli === args.cli && x.scope === args.scope && x.name === args.name);
        if (i < 0) throw `pty: skill "${String(args.name)}" not found`;
        extSkills.splice(i, 1);
        return null;
      }
      case "list_mcp":
        return extMcp.filter((x) => x.cli === args.cli && (x.scope === "user" || args.cwd)).map((x) => ({ ...x, cli: undefined }));
      case "add_mcp": {
        const sv = args.server as { name: string; transport: string; command: string; args: string[]; url: string; env: [string, string][]; scope: "user" | "project" };
        if (sv.name === "fail") throw "pty: error: MCP server fail already exists in user config";
        extMcp.push({
          cli: String(args.cli),
          name: sv.name,
          transport: sv.transport,
          command: sv.transport === "stdio" ? sv.command : null,
          args: sv.args,
          url: sv.transport === "stdio" ? null : sv.url,
          envKeys: sv.env.map((e) => e[0]),
          headerKeys: [],
          scope: sv.scope,
          source: sv.scope === "user" ? "C:/Users/dev/.claude.json" : "C:/Users/dev/proj/.mcp.json",
        });
        return `Added ${sv.name}`;
      }
      case "remove_mcp": {
        const i = extMcp.findIndex((x) => x.cli === args.cli && x.scope === args.scope && x.name === args.name);
        if (i < 0) throw `pty: No MCP server found with name: ${String(args.name)}`;
        extMcp.splice(i, 1);
        return `Removed ${String(args.name)}`;
      }
      case "usage_for_sessions": {
        const ids = (args.sessionIds as string[]) ?? [];
        return Object.fromEntries(ids.filter((i) => i === "s1").map((i) => [i, { tokens: 12_400, messages: 37, model: "claude-opus-4-5" }]));
      }
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
      case "fs_list":
        return fsList(String(args.rel));
      case "fs_read": {
        const rel = String(args.rel);
        if (fsBad(rel)) throw "io: path escapes the project folder";
        const text = fakeFs[rel];
        if (text === undefined) throw "io: No such file or directory";
        return { text: text.includes("\u0000") ? "" : text, truncated: false, binary: text.includes("\u0000") };
      }
      case "fs_write": {
        const rel = String(args.rel);
        if (fsBad(rel)) throw "io: path escapes the project folder";
        fakeFs[rel] = String(args.text);
        return null;
      }
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
      // native web-tile browser (src-tauri/src/browser.rs) — recorded in __ipcLog, no real webview
      case "browser_open":
      case "browser_set_bounds":
      case "browser_navigate":
      case "browser_action":
      case "browser_close":
      case "browser_hide_all":
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

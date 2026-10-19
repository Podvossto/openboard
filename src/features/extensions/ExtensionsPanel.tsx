import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { ipc } from "../../lib/ipc";
import { ask, useDialogStore } from "../../lib/dialog";
import type { AddMcpServer, ExtCli, ExtScope, McpServer, McpTransport, Skill } from "../../lib/types";
import { useBoard } from "../../store/board";
import { profilesFor } from "../settings/profiles";
import { buildMcpServer, mcpTarget, slugifySkill, validateSkillForm } from "./logic";
import "../settings/settings.css";

type Tab = "skills" | "mcp";
type ScopeFilter = "all" | ExtScope;

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

function Badge({ children, tone }: { children: string; tone?: "ok" | "warn" }) {
  return <span className={`chip ${tone ?? ""}`}>{children}</span>;
}

export function ExtensionsPanel({ tab: initialTab, onClose }: { tab: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [cli, setCli] = useState<ExtCli>("claude");
  const [profile, setProfile] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const settings = useBoard((s) => s.settings);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const cwd = settings.defaultCwd || resolvedCwd || null;
  const accounts = useMemo(
    () => profilesFor({ kind: cli === "claude" ? "claudeCode" : "codex" }, settings.profiles ?? []),
    [cli, settings.profiles],
  );

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useDialogStore.getState().dialog) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const prof = profile && accounts.some((p) => p.id === profile) ? profile : "";

  return (
    <motion.div
      className="sheet-backdrop"
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.aside variants={sheetVariants} className="panel sheet" role="dialog" aria-modal="true" aria-label="Skills and MCP" style={{ width: 520 }}>
        <header className="sheet-head">
          <h2>Skills &amp; MCP</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close skills and MCP" title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-line bg-surface-2/40 px-5 py-2" role="tablist">
          {(["skills", "mcp"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3.5 py-1 text-[12.5px] font-medium transition ${
                tab === t
                  ? "bg-surface-3 font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {t === "skills" ? "Skills" : "MCP servers"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
          <div className="seg" role="radiogroup" aria-label="CLI">
            {(["claude", "codex"] as const).map((c) => (
              <button key={c} role="radio" aria-checked={cli === c} className={cli === c ? "on" : ""} onClick={() => setCli(c)}>
                {c === "claude" ? "Claude Code" : "Codex"}
              </button>
            ))}
          </div>
          <select className="input h-8 max-w-[150px] text-[12px]" aria-label="Account" value={prof} onChange={(e) => setProfile(e.target.value)}>
            <option value="">Default login</option>
            {accounts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="seg ml-auto" role="radiogroup" aria-label="Scope filter">
            {(["all", "user", "project"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={scopeFilter === s} className={scopeFilter === s ? "on" : ""} onClick={() => setScopeFilter(s)}>
                {s === "all" ? "All" : s === "user" ? "User" : "Project"}
              </button>
            ))}
          </div>
        </div>
        {scopeFilter !== "user" && (
          <div className="px-5 pt-2 text-[11.5px] text-ink-3">
            Project folder: <code className="text-ink-2">{cwd ?? "—"}</code>
          </div>
        )}

        <div className="sheet-body">
          {tab === "skills" ? (
            <SkillsTab cli={cli} profile={prof || null} cwd={cwd} scopeFilter={scopeFilter} />
          ) : (
            <McpTab cli={cli} profile={prof || null} cwd={cwd} scopeFilter={scopeFilter} />
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}

interface TabProps {
  cli: ExtCli;
  profile: string | null;
  cwd: string | null;
  scopeFilter: ScopeFilter;
}

function Empty({ children }: { children: string }) {
  return <p className="help py-6 text-center">{children}</p>;
}

function SkillsTab({ cli, profile, cwd, scopeFilter }: TabProps) {
  const [items, setItems] = useState<Skill[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError("");
    ipc
      .listSkills(cli, profile, cwd)
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(errText(e));
      });
  }, [cli, profile, cwd]);
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const shown = (items ?? []).filter(
    (s) =>
      (scopeFilter === "all" || s.scope === scopeFilter) &&
      `${s.name} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const remove = async (s: Skill) => {
    if (!(await ask(`Delete skill "${s.name}"? Its folder will be removed from disk.`, { title: "Delete skill", kind: "danger", confirmText: "Delete" }))) return;
    try {
      await ipc.deleteSkill(cli, profile, cwd, s.scope, s.name);
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <section className="set-section">
      <div className="row">
        <input className="input grow" placeholder="Search skills…" aria-label="Search skills" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          New skill
        </button>
      </div>
      {adding && (
        <NewSkillForm
          cli={cli}
          profile={profile}
          cwd={cwd}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {error && (
        <p className="help text-danger" role="alert">
          {error}
        </p>
      )}
      {items === null ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{items.length === 0 ? "No skills yet." : "No skills match."}</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Skills">
          {shown.map((s) => (
            <li key={`${s.scope}:${s.kind}:${s.name}`} className="agent-card" data-testid="skill-card">
              <div className="agent-card-head">
                <strong className="min-w-0 flex-1 truncate">{s.name}</strong>
                <Badge tone={s.scope === "project" ? "warn" : undefined}>{s.kind === "prompt" ? "prompt" : s.scope}</Badge>
                {s.kind === "skill" && (
                  <button className="btn ghost sm !ml-0" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>
                    Delete
                  </button>
                )}
              </div>
              {s.description && <p className="help line-clamp-3">{s.description}</p>}
              <p className="help truncate font-mono text-[11px]" title={s.path}>
                {s.path}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewSkillForm({ cli, profile, cwd, onDone }: { cli: ExtCli; profile: string | null; cwd: string | null; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<ExtScope>("user");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const bad = validateSkillForm({ name, description, body });
    if (bad) return setErr(bad);
    setBusy(true);
    try {
      await ipc.createSkill(cli, profile, cwd, scope, name, description.trim(), body);
      onDone();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="agent-card"
      aria-label="New skill"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor="sk-name">Name</label>
        <input id="sk-name" className="input" value={name} placeholder="my-skill" spellCheck={false} onChange={(e) => setName(e.target.value)} onBlur={() => name && setName(slugifySkill(name) || name)} />
      </div>
      <div className="field">
        <label htmlFor="sk-desc">Description</label>
        <input id="sk-desc" className="input" value={description} placeholder="When should the agent use this?" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sk-body">Instructions (markdown)</label>
        <textarea id="sk-body" className="input" rows={5} value={body} spellCheck={false} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="row">
        <div className="seg" role="radiogroup" aria-label="Skill scope">
          {(["user", "project"] as const).map((s) => (
            <button type="button" key={s} role="radio" aria-checked={scope === s} className={scope === s ? "on" : ""} onClick={() => setScope(s)}>
              {s === "user" ? "User" : "Project"}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button type="submit" className="btn primary sm" disabled={busy}>
          Create skill
        </button>
      </div>
      {err && (
        <p className="help text-danger" role="alert">
          {err}
        </p>
      )}
    </form>
  );
}

function McpTab({ cli, profile, cwd, scopeFilter }: TabProps) {
  const [items, setItems] = useState<McpServer[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    ipc
      .listMcp(cli, profile, cwd)
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(errText(e));
      });
  }, [cli, profile, cwd]);
  useEffect(() => {
    setItems(null);
    setError("");
    load();
  }, [load]);

  const shown = (items ?? []).filter(
    (s) =>
      (scopeFilter === "all" || s.scope === scopeFilter) &&
      `${s.name} ${mcpTarget(s)}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const remove = async (s: McpServer) => {
    if (!(await ask(`Remove MCP server "${s.name}" (${s.scope})? The ${cli === "claude" ? "claude" : "codex"} CLI will update its config.`, { title: "Remove MCP server", kind: "danger", confirmText: "Remove" }))) return;
    setError("");
    try {
      await ipc.removeMcp(cli, profile, cwd, s.name, s.scope);
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <section className="set-section">
      <div className="row">
        <input className="input grow" placeholder="Search servers…" aria-label="Search servers" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          Add server
        </button>
      </div>
      {adding && (
        <AddServerForm
          cli={cli}
          profile={profile}
          cwd={cwd}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {error && (
        <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-danger/40 bg-danger/10 p-3 text-[12px] text-danger" role="alert">
          {error}
        </pre>
      )}
      {items === null ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{items.length === 0 ? "No MCP servers configured." : "No servers match."}</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="MCP servers">
          {shown.map((s) => (
            <li key={`${s.scope}:${s.name}`} className="agent-card" data-testid="mcp-card">
              <div className="agent-card-head">
                <strong className="min-w-0 flex-1 truncate">{s.name}</strong>
                <Badge tone="ok">{s.transport}</Badge>
                <Badge tone={s.scope === "project" ? "warn" : undefined}>{s.scope}</Badge>
                <button className="btn ghost sm !ml-0" aria-label={`Remove ${s.name}`} onClick={() => void remove(s)}>
                  Remove
                </button>
              </div>
              <p className="help truncate font-mono text-[11.5px]" title={mcpTarget(s)}>
                {mcpTarget(s)}
              </p>
              {(s.envKeys.length > 0 || s.headerKeys.length > 0) && (
                <p className="help">
                  {s.envKeys.length > 0 && <>env: {s.envKeys.join(", ")} </>}
                  {s.headerKeys.length > 0 && <>headers: {s.headerKeys.join(", ")}</>}
                  <span className="text-ink-3"> (values hidden)</span>
                </p>
              )}
              <p className="help truncate text-[11px]" title={s.source}>
                {s.source}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddServerForm({ cli, profile, cwd, onDone }: { cli: ExtCli; profile: string | null; cwd: string | null; onDone: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<ExtScope>("user");
  const [env, setEnv] = useState<{ key: string; value: string }[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const transports: McpTransport[] = cli === "codex" ? ["stdio", "http"] : ["stdio", "http", "sse"];

  const submit = async () => {
    const r = buildMcpServer({ name, transport, target, env, scope }, cli);
    if (!r.ok) return setErr(r.error);
    setBusy(true);
    setErr("");
    try {
      const server: AddMcpServer = r.server;
      await ipc.addMcp(cli, profile, cwd, server);
      onDone();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="agent-card"
      aria-label="Add MCP server"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor="mcp-name">Name</label>
        <input id="mcp-name" className="input" value={name} placeholder="context7" spellCheck={false} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="seg" role="radiogroup" aria-label="Transport">
          {transports.map((t) => (
            <button type="button" key={t} role="radio" aria-checked={transport === t} className={transport === t ? "on" : ""} onClick={() => setTransport(t)}>
              {t}
            </button>
          ))}
        </div>
        <span className="grow" />
        <div className="seg" role="radiogroup" aria-label="Server scope">
          {(["user", "project"] as const).map((s) => (
            <button type="button" key={s} role="radio" aria-checked={scope === s} disabled={cli === "codex" && s === "project"} className={scope === s ? "on" : ""} onClick={() => setScope(s)}>
              {s === "user" ? "User" : "Project"}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="mcp-target">{transport === "stdio" ? "Command and arguments" : "URL"}</label>
        <input
          id="mcp-target"
          className="input"
          value={target}
          spellCheck={false}
          placeholder={transport === "stdio" ? "npx -y @upstash/context7-mcp" : "https://example.com/mcp"}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Environment variables</label>
        {env.map((r, i) => (
          <div className="row" key={i}>
            <input className="input narrow !w-[130px]" aria-label={`Env name ${i + 1}`} placeholder="KEY" value={r.key} spellCheck={false} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <input className="input grow" type="password" autoComplete="off" aria-label={`Env value ${i + 1}`} placeholder="value" value={r.value} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="btn ghost sm" aria-label={`Remove env ${i + 1}`} onClick={() => setEnv(env.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn sm self-start" onClick={() => setEnv([...env, { key: "", value: "" }])}>
          + Env variable
        </button>
      </div>
      {err && (
        <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-danger/40 bg-danger/10 p-3 text-[12px] text-danger" role="alert">
          {err}
        </pre>
      )}
      <div className="row">
        <span className="grow" />
        <button type="submit" className="btn primary sm" disabled={busy}>
          {busy ? "Adding…" : "Add server"}
        </button>
      </div>
    </form>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { AgentKind, AuthInfo, Detected, Settings } from "../../lib/types";
import { activeWorkspace, CONSOLE_H, CONSOLE_W, nextPosition, useBoard } from "../../store/board";
import { clampFont, formatArgs, parseArgs } from "./args";
import { AgentIcon } from "../../components/AgentIcon";
import "./settings.css";

type AgentChoice = "claudeCode" | "codex" | "shell";

const CHOICES: { id: AgentChoice; label: string }[] = [
  { id: "claudeCode", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "shell", label: "Shell" },
];

function choiceOf(a: AgentKind): AgentChoice {
  return a.kind === "custom" ? "shell" : a.kind;
}

function agentOf(c: AgentChoice): AgentKind {
  return c === "shell" ? { kind: "custom", program: "" } : { kind: c };
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="set-switch-row">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

function statusOf(a: AuthInfo | undefined): { text: string; cls: string } {
  if (!a) return { text: "Checking…", cls: "" };
  if (!a.installed) return { text: "Not installed", cls: "off" };
  if (!a.loggedIn) return { text: "Signed out", cls: "warn" };
  return { text: "Signed in", cls: "ok" };
}

function AgentCard({
  name,
  agent,
  info,
  args,
  onArgs,
  onLogin,
}: {
  name: string;
  agent: "claudeCode" | "codex";
  info: AuthInfo | undefined;
  args: string[];
  onArgs: (a: string[]) => void;
  onLogin: () => void;
}) {
  const st = statusOf(info);
  const [text, setText] = useState(() => formatArgs(args));
  const idBase = `args-${agent}`;
  return (
    <div className="agent-card">
      <div className="agent-card-head">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-black/30">
          <AgentIcon agent={agent} size={17} />
        </span>
        <strong>{name}</strong>
        <span className={`chip ${st.cls}`}>{st.text}</span>
        <span className="agent-detail">{info?.detail ?? ""}</span>
        <button className="btn sm" disabled={!info?.installed} onClick={onLogin}>
          {info?.loggedIn ? "Re-authenticate" : "Sign in"}
        </button>
      </div>
      <div className="field">
        <label htmlFor={idBase}>Extra CLI arguments</label>
        <input
          id={idBase}
          className="input"
          value={text}
          placeholder="e.g. --model opus"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            onArgs(parseArgs(e.target.value));
          }}
        />
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Settings>(() => useBoard.getState().settings);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [fontText, setFontText] = useState(() => String(useBoard.getState().settings.fontSize));

  const pending = useRef<Settings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstField = useRef<HTMLInputElement>(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const s = pending.current;
    if (!s) return;
    pending.current = null;
    try {
      const res = await ipc.saveSettings(s);
      useBoard.getState().setSettings(res.settings, res.resolvedCwd);
      setSaveErr(null);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setSaveErr(String(e));
    }
  }, []);

  const patch = useCallback(
    (p: Partial<Settings>) => {
      setDraft((d) => {
        const next = { ...d, ...p };
        pending.current = next;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 300);
        return next;
      });
    },
    [flush],
  );

  // flush any pending save on close; stop the "Saved" timer
  useEffect(
    () => () => {
      clearTimeout(savedTimer.current);
      const s = pending.current;
      clearTimeout(timer.current);
      if (s) {
        pending.current = null;
        void ipc
          .saveSettings(s)
          .then((res) => useBoard.getState().setSettings(res.settings, res.resolvedCwd))
          .catch(() => undefined);
      }
    },
    [],
  );

  const detect = useCallback(() => {
    setDetecting(true);
    ipc
      .detectAgents()
      .then(setDetected)
      .catch(() => setDetected(null))
      .finally(() => setDetecting(false));
  }, []);

  useEffect(() => {
    detect();
    firstField.current?.focus();
  }, [detect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const browse = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: draft.defaultCwd || resolvedCwd || undefined }).catch(
      () => null,
    );
    if (typeof dir === "string") patch({ defaultCwd: dir });
  };

  const login = async (agent: "claudeCode" | "codex") => {
    const st = useBoard.getState();
    const a: AgentKind = { kind: agent };
    const id = await ipc.newId();
    const title = agent === "claudeCode" ? "claude login" : "codex login";
    st.addConsoles([
      {
        id,
        title,
        agent: a,
        cwd: "",
        ...nextPosition(activeWorkspace(st.board).consoles),
        width: CONSOLE_W,
        height: CONSOLE_H,
      },
    ]);
    await ipc.spawn({ id, agent: a, cwd: "", cols: 100, rows: 30, resume: false, login: true });
    useBoard.getState().setRuntime(id, { running: true });
    onClose();
  };

  const choice = choiceOf(draft.defaultAgent);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="sheet-head">
          <h2>Settings</h2>
          <span className={`saved${saved ? " show" : ""}${saveErr ? " err" : ""}`} role="status">
            {saveErr ? "Save failed" : "Saved"}
          </span>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="sheet-body">
          <section className="set-section">
            <h3>General</h3>
            <div className="field">
              <label htmlFor="set-cwd">Default working directory</label>
              <div className="row">
                <input
                  id="set-cwd"
                  ref={firstField}
                  className="input grow"
                  value={draft.defaultCwd}
                  placeholder={resolvedCwd || "Home folder"}
                  spellCheck={false}
                  onChange={(e) => patch({ defaultCwd: e.target.value })}
                />
                <button className="btn" onClick={() => void browse()}>
                  Browse…
                </button>
                <button
                  className="btn ghost"
                  disabled={!draft.defaultCwd}
                  onClick={() => patch({ defaultCwd: "" })}
                  title="Use the home folder"
                >
                  Clear
                </button>
              </div>
              <span className="help">New consoles open here unless you pick another folder.</span>
            </div>

            <div className="field">
              <label id="set-agent-label">Default agent</label>
              <div className="seg" role="radiogroup" aria-labelledby="set-agent-label">
                {CHOICES.map((c) => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={choice === c.id}
                    className={choice === c.id ? "on" : ""}
                    onClick={() => patch({ defaultAgent: agentOf(c.id) })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="set-shell">Shell</label>
              <input
                id="set-shell"
                className="input"
                value={draft.shell}
                placeholder={detected?.shell || "auto-detect"}
                spellCheck={false}
                onChange={(e) => patch({ shell: e.target.value })}
              />
              <span className="help">Program used for Shell consoles. Leave empty to auto-detect.</span>
            </div>

            <div className="field">
              <label htmlFor="set-font">Font size</label>
              <input
                id="set-font"
                className="input narrow"
                type="number"
                min={10}
                max={20}
                value={fontText}
                onChange={(e) => {
                  setFontText(e.target.value);
                  const n = Number(e.target.value);
                  if (e.target.value !== "" && n >= 10 && n <= 20) patch({ fontSize: clampFont(n) });
                }}
                onBlur={() => setFontText(String(clampFont(Number(fontText || draft.fontSize))))}
              />
            </div>
          </section>

          <section className="set-section">
            <div className="set-title-row">
              <h3>Agents &amp; accounts</h3>
              <button className="btn ghost sm" onClick={detect} disabled={detecting} title="Re-check installed CLIs">
                {detecting ? "Checking…" : "Refresh"}
              </button>
            </div>
            <AgentCard
              name="Claude Code"
              agent="claudeCode"
              info={detected?.claude}
              args={draft.claudeArgs}
              onArgs={(a) => patch({ claudeArgs: a })}
              onLogin={() => void login("claudeCode")}
            />
            <AgentCard
              name="Codex"
              agent="codex"
              info={detected?.codex}
              args={draft.codexArgs}
              onArgs={(a) => patch({ codexArgs: a })}
              onLogin={() => void login("codex")}
            />
            <p className="help">
              Agent Board never stores tokens or passwords. Signing in opens a console that runs the CLI's own login
              flow; credentials stay with the CLI.
            </p>
          </section>

          <section className="set-section">
            <h3>Notifications</h3>
            <Switch
              label="Blink console border when it needs you"
              checked={draft.blinkNeedsYou}
              onChange={(v) => patch({ blinkNeedsYou: v })}
            />
            <Switch
              label="OS notification when a console needs you"
              checked={draft.notifyNeedsYou}
              onChange={(v) => patch({ notifyNeedsYou: v })}
            />
            <Switch
              label="Show Claude usage in top bar"
              checked={draft.showUsage}
              onChange={(v) => patch({ showUsage: v })}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

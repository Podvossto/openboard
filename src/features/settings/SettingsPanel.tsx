import { motion } from "motion/react";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { AgentKind, AuthInfo, CatalogStatus, Detected, Settings } from "../../lib/types";
import { activeWorkspace, CONSOLE_H, CONSOLE_W, nextPosition, useBoard } from "../../store/board";
import { clampFont, formatArgs, parseArgs } from "./args";
import { AgentIcon, CatalogIcon } from "../../components/AgentIcon";
import { ProfilesSection } from "./ProfilesSection";
import { UpdateSettings } from "../updater/UpdatePrompt";
import "./settings.css";

type TabId = "general" | "agents" | "providers" | "terminal";
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
    <label className="set-switch-row cursor-pointer">
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
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong>{name}</strong>
            <span className={`chip ${st.cls}`}>{st.text}</span>
          </div>
          {info?.detail && <span className="agent-detail truncate text-[11.5px] text-ink-3">{info.detail}</span>}
        </div>
        <button className="btn sm" disabled={!info?.installed} onClick={onLogin}>
          {info?.loggedIn ? "Re-authenticate" : "Sign in"}
        </button>
      </div>
      <div className="field mt-2">
        <label htmlFor={idBase}>Default CLI arguments</label>
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

function CatalogItem({ item }: { item: CatalogStatus }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-black/30 text-ink-2 font-mono text-[11px] font-bold">
          <CatalogIcon id={item.id} size={15} />
        </span>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-ink">{item.name}</span>
          <span className="font-mono text-[10.5px] text-ink-3">{item.program}</span>
        </div>
      </div>
      <span className={`chip ${item.installed ? "ok" : "off"}`}>
        {item.installed ? "Available" : "Not on PATH"}
      </span>
    </div>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>(() => (useBoard.getState().ui.settingsTab as TabId | undefined) ?? "general");
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

  const login = async (agent: "claudeCode" | "codex", profile?: string, profileName?: string) => {
    await flush();
    const st = useBoard.getState();
    const a: AgentKind = { kind: agent };
    const id = await ipc.newId();
    const title = `${agent === "claudeCode" ? "claude" : "codex"} login${profileName ? ` · ${profileName}` : ""}`;
    st.addConsoles([
      {
        id,
        title,
        agent: a,
        cwd: "",
        ...nextPosition(activeWorkspace(st.board).consoles),
        width: CONSOLE_W,
        height: CONSOLE_H,
        profile,
      },
    ]);
    await ipc.spawn({ id, agent: a, cwd: "", cols: 100, rows: 30, resume: false, login: true, profile });
    useBoard.getState().setRuntime(id, { running: true });
    onClose();
  };

  const choice = choiceOf(draft.defaultAgent);

  const tabs: { id: TabId; label: string }[] = [
    { id: "general", label: "General" },
    { id: "agents", label: "Agents & CLIs" },
    { id: "providers", label: "Providers & Accounts" },
    { id: "terminal", label: "Terminal" },
  ];

  return (
    <motion.div className="sheet-backdrop" variants={fadeVariants} initial="initial" animate="animate" exit="exit" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.aside variants={sheetVariants} className="panel sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="sheet-head">
          <div className="flex items-center gap-3">
            <h2>Settings</h2>
            <span className={`saved${saved ? " show" : ""}${saveErr ? " err" : ""}`} role="status">
              {saveErr ? "Save failed" : "Saved"}
            </span>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-line px-5 py-2 bg-surface-2/40">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`rounded-full px-3.5 py-1 text-[12.5px] font-medium transition ${
                activeTab === t.id
                  ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] font-semibold"
                  : "text-ink-3 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-body">
          {activeTab === "general" && (
            <section className="set-section">
              <h3>General Preferences</h3>
              <div className="field">
                <label>Updates</label>
                <UpdateSettings />
              </div>
              <div className="field">
                <label htmlFor="set-cwd">Default working directory</label>
                <div className="row">
                  <input
                    id="set-cwd"
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
                <span className="help">New consoles open here unless you specify another folder.</span>
              </div>

              <div className="field">
                <label id="set-agent-label">Default agent for new consoles</label>
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
                <label htmlFor="set-shell">Shell Program</label>
                <input
                  id="set-shell"
                  className="input"
                  value={draft.shell}
                  placeholder={detected?.shell || "auto-detect"}
                  spellCheck={false}
                  onChange={(e) => patch({ shell: e.target.value })}
                />
                <span className="help">Executable used for Shell consoles. Leave empty to auto-detect.</span>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <Switch
                  label="Resume consoles on launch"
                  checked={draft.autoResume}
                  onChange={(v) => patch({ autoResume: v })}
                />
                <Switch
                  label="Blink console border when it needs you"
                  checked={draft.blinkNeedsYou}
                  onChange={(v) => patch({ blinkNeedsYou: v })}
                />
                <Switch
                  label="OS desktop notification when a console needs you"
                  checked={draft.notifyNeedsYou}
                  onChange={(v) => patch({ notifyNeedsYou: v })}
                />
                <Switch
                  label="Show usage in top navigation bar"
                  checked={draft.showUsage}
                  onChange={(v) => patch({ showUsage: v })}
                />
              </div>
            </section>
          )}

          {activeTab === "agents" && (
            <section className="set-section">
              <div className="set-title-row">
                <h3>Primary Agent CLIs</h3>
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

              <div className="mt-5">
                <h3 className="mb-2">Other Detected CLIs</h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {(detected?.catalog ?? []).map((item) => (
                    <CatalogItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeTab === "providers" && (
            <section className="set-section">
              <h3>Providers &amp; Additional Accounts</h3>
              <ProfilesSection
                profiles={draft.profiles ?? []}
                onChange={(profiles) => patch({ profiles })}
                onLogin={(p) => void login(p.cli === "claude" ? "claudeCode" : "codex", p.id, p.name)}
              />
            </section>
          )}

          {activeTab === "terminal" && (
            <section className="set-section">
              <h3>Terminal &amp; Display</h3>
              <div className="field">
                <label htmlFor="set-font">Terminal font size (px)</label>
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
                <span className="help">Controls font size in xterm terminals (scales smoothly with canvas zoom).</span>
              </div>
            </section>
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}

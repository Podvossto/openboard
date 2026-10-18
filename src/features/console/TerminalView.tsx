import { AgentIcon } from "../../components/AgentIcon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ConsoleNode } from "../../lib/types";
import { ipc } from "../../lib/ipc";
import { autoStart } from "../../lib/actions";
import { agentLabel, useBoard } from "../../store/board";
import { canResume, shortPath } from "./helpers";
import { terminalControls } from "./controls";

type Phase = "attaching" | "live" | "stopped";

const inflight = new Set<string>();

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * One xterm per console. On mount: auto-start if flagged, otherwise try to attach
 * (PTY alive → replay scrollback), otherwise show a Resume / Start overlay.
 */
export function TerminalView({ console: c }: { console: ConsoleNode }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const cRef = useRef(c);
  cRef.current = c;
  const [phase, setPhase] = useState<Phase>("attaching");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useBoard((s) => s.runtime[c.id]?.running ?? false);
  const exitCode = useBoard((s) => s.runtime[c.id]?.exitCode);
  const fontSize = useBoard((s) => s.settings.fontSize);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);

  // Create xterm once per console.
  useEffect(() => {
    const t = new Terminal({
      fontFamily: cssVar("--mono", "monospace"),
      fontSize: useBoard.getState().settings.fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: "#0e0f12",
        foreground: cssVar("--text", "#e3e6ee"),
        cursor: cssVar("--accent", "#7c9cff"),
        cursorAccent: "#0e0f12",
        selectionBackground: "rgba(124, 156, 255, 0.3)",
      },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    const data = t.onData((d) => void ipc.write(c.id, d).catch(() => undefined));
    const res = t.onResize(({ cols, rows }) => void ipc.resize(c.id, cols, rows).catch(() => undefined));
    let raf = 0;
    const doFit = () => {
      raf = 0;
      try {
        f.fit();
      } catch {
        /* host not laid out yet */
      }
    };
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(doFit);
    });
    ro.observe(host.current!);
    doFit();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      data.dispose();
      res.dispose();
      t.dispose();
      if (term.current === t) term.current = null;
    };
  }, [c.id]);

  // Live font-size changes from Settings.
  useEffect(() => {
    const t = term.current;
    if (!t || t.options.fontSize === fontSize) return;
    t.options.fontSize = fontSize;
    try {
      fit.current?.fit();
    } catch {
      /* ignore */
    }
  }, [fontSize]);

  const attach = useCallback(async () => {
    const ok = await ipc.attach(c.id, (bytes) => term.current?.write(bytes));
    if (ok) {
      useBoard.getState().setRuntime(c.id, { running: true });
      const st = await ipc.status(c.id);
      if (st) useBoard.getState().setRuntime(c.id, { status: st });
    }
    return ok;
  }, [c.id]);

  const start = useCallback(
    async (resume: boolean) => {
      if (inflight.has(c.id)) return;
      inflight.add(c.id);
      setBusy(true);
      setError(null);
      const st = useBoard.getState();
      try {
        if (st.runtime[c.id]?.running) {
          await ipc.kill(c.id).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 150));
        }
        const node = cRef.current;
        let agentSession = node.agentSession;
        if (node.agent.kind === "claudeCode" && !resume) {
          agentSession = await ipc.newId();
          st.patchConsole(c.id, { agentSession });
        }
        try {
          fit.current?.fit();
        } catch {
          /* ignore */
        }
        const t = term.current;
        t?.reset();
        st.setRuntime(c.id, { status: "starting", exitCode: undefined });
        await ipc.spawn({
          id: c.id,
          agent: node.agent,
          cwd: cRef.current.cwd,
          cols: t?.cols ?? 80,
          rows: t?.rows ?? 24,
          agentSession,
          resume,
        });
        if (await attach()) {
          setPhase("live");
          term.current?.focus();
        }
      } catch (e) {
        setError(String(e));
        setPhase("stopped");
      } finally {
        inflight.delete(c.id);
        setBusy(false);
      }
    },
    [c.id, attach],
  );

  // Expose start to the node's "…" menu.
  useEffect(() => {
    terminalControls.set(c.id, { start });
    return () => {
      terminalControls.delete(c.id);
    };
  }, [c.id, start]);

  // On mount: auto-start (new consoles) or re-attach to a live PTY, else show the overlay.
  useEffect(() => {
    let cancelled = false;
    if (autoStart.has(c.id)) {
      autoStart.delete(c.id);
      void start(false);
      return;
    }
    if (inflight.has(c.id)) return;
    attach()
      .then((ok) => !cancelled && setPhase(ok ? "live" : "stopped"))
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setPhase("stopped");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [c.id, attach, start]);

  useEffect(() => {
    if (!busy && phase === "live" && !running) setPhase("stopped");
  }, [running, phase, busy]);

  const resumable = canResume(c);
  const showOverlay = phase === "stopped" && !busy && !running;
  const cwdShown = c.cwd || resolvedCwd;

  return (
    <div className="terminal-wrap" onMouseDown={() => useBoard.getState().setFocused(c.id)}>
      <div ref={host} className="terminal-host" />
      {showOverlay && (
        <div className="console-overlay" role="dialog" aria-label="Start console">
          <div className="console-overlay-card">
            <div className="console-overlay-icon"><AgentIcon agent={c.agent.kind} size={24} /></div>
            <div className="console-overlay-title">{agentLabel(c.agent)}</div>
            <div className="console-overlay-cwd" title={cwdShown}>
              {shortPath(cwdShown, 3) || "default folder"}
            </div>
            {exitCode !== undefined && (
              <div className="console-overlay-exit">
                Last run exited{exitCode !== null ? ` with code ${exitCode}` : ""}
              </div>
            )}
            {error && <div className="console-overlay-error">{error}</div>}
            <div className="console-overlay-actions">
              {resumable && (
                <button className="btn primary" autoFocus onClick={() => void start(true)}>
                  Resume last session
                </button>
              )}
              <button className={resumable ? "btn" : "btn primary"} onClick={() => void start(false)}>
                Start new
              </button>
            </div>
          </div>
        </div>
      )}
      {busy && !running && <div className="console-overlay busy">Starting…</div>}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ConsoleNode } from "../../lib/types";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";

type Phase = "attaching" | "live" | "stopped" | "error";

/**
 * One xterm per console. On mount it tries to *attach* (PTY already alive → replay
 * scrollback). If nothing is running it shows Start / Resume — the user confirms
 * before any agent is launched.
 */
export function TerminalView({ console: c }: { console: ConsoleNode }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [phase, setPhase] = useState<Phase>("attaching");
  const [error, setError] = useState<string | null>(null);
  const running = useBoard((s) => s.runtime[c.id]?.running ?? false);
  const exitCode = useBoard((s) => s.runtime[c.id]?.exitCode);

  // Create xterm once.
  useEffect(() => {
    const t = new Terminal({
      fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: { background: "#0e1117", foreground: "#d6dae3" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    const enc = t.onData((d) => void ipc.write(c.id, d).catch(() => undefined));
    const res = t.onResize(({ cols, rows }) => void ipc.resize(c.id, cols, rows).catch(() => undefined));
    const ro = new ResizeObserver(() => {
      try {
        f.fit();
      } catch {
        /* host not laid out yet */
      }
    });
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      enc.dispose();
      res.dispose();
      t.dispose();
    };
  }, [c.id]);

  const attach = useCallback(async () => {
    const t = term.current!;
    const ok = await ipc.attach(c.id, (bytes) => t.write(bytes));
    if (ok) {
      useBoard.getState().setRuntime(c.id, { running: true });
      const st = await ipc.status(c.id);
      if (st) useBoard.getState().setRuntime(c.id, { status: st });
    }
    return ok;
  }, [c.id]);

  // On mount: re-attach to a live PTY (webview reload) or show the start screen.
  useEffect(() => {
    let cancelled = false;
    attach()
      .then((ok) => !cancelled && setPhase(ok ? "live" : "stopped"))
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setPhase("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attach]);

  useEffect(() => {
    if (phase === "live" && !running) setPhase("stopped");
  }, [running, phase]);

  const start = async (resume: boolean) => {
    setError(null);
    const t = term.current!;
    try {
      fit.current?.fit();
    } catch {
      /* ignore */
    }
    let agentSession = c.agentSession;
    if (c.agent.kind === "claudeCode" && !resume) {
      agentSession = await ipc.newConsoleId(); // fresh uuid for --session-id
      useBoard.getState().patchConsole(c.id, { agentSession });
    }
    try {
      t.reset();
      useBoard.getState().setRuntime(c.id, { status: "starting", exitCode: undefined });
      await ipc.spawn({
        id: c.id,
        agent: c.agent,
        cwd: c.cwd,
        cols: t.cols,
        rows: t.rows,
        agentSession,
        resume,
      });
      if (await attach()) {
        setPhase("live");
        t.focus();
      }
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  };

  const canResume = c.agent.kind !== "custom" && (c.agent.kind === "codex" || !!c.agentSession);

  return (
    <div className="terminal-wrap">
      <div ref={host} className="terminal-host" />
      {phase !== "live" && phase !== "attaching" && (
        <div className="overlay">
          {exitCode !== undefined && phase === "stopped" && (
            <p className="muted">Process exited{exitCode !== null ? ` (code ${exitCode})` : ""}.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row">
            {canResume && (
              <button className="primary" onClick={() => void start(true)}>
                Resume last session
              </button>
            )}
            <button className={canResume ? "" : "primary"} onClick={() => void start(false)}>
              Start new
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

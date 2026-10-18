import { ConsoleAgentIcon } from "../../components/AgentIcon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { useStore } from "@xyflow/react";
import { motion } from "motion/react";
import { spring } from "../../lib/motion";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ConsoleNode } from "../../lib/types";
import { ipc } from "../../lib/ipc";
import { autoStart } from "../../lib/actions";
import { agentLabel, useBoard } from "../../store/board";
import { canResume, shortPath } from "./helpers";
import { terminalControls } from "./controls";
import { launchConsole, launchInflight, terminalSizes } from "./launch";

type Phase = "attaching" | "live" | "stopped";

const selectZoom = (s: { transform: [number, number, number] }) => s.transform[2];

/** xterm font size that renders crisply at board zoom `z` (≥ 1px, 0.25px steps). */
export function renderFont(base: number, z: number): number {
  return Math.max(1, Math.round(base * z * 4) / 4);
}

/** Zoom that only updates once the user stops zooming (avoid re-rasterising every frame). */
function useSettledZoom(live: number, ms = 140): number {
  const [z, setZ] = useState(live);
  useEffect(() => {
    if (live === z) return;
    const t = setTimeout(() => setZ(Math.round(live * 100) / 100), ms);
    return () => clearTimeout(t);
  }, [live, z, ms]);
  return z;
}

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
  const outer = useRef<HTMLDivElement>(null);
  const fitNow = useRef<(() => void) | null>(null);
  const zoomChanging = useRef(false);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [phase, setPhase] = useState<Phase>("attaching");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useBoard((s) => s.runtime[c.id]?.running ?? false);
  const exitCode = useBoard((s) => s.runtime[c.id]?.exitCode);
  const fontSize = useBoard((s) => s.settings.fontSize);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);

  // Crisp text at any board zoom: React Flow scales the whole board with a CSS transform, which
  // makes glyphs resampled (blurry) at zoom ≠ 1. We counter-scale the terminal host by 1/zoom and
  // render xterm at fontSize × zoom, so glyphs are rasterised at their on-screen pixel size.
  // The grid (cols × rows) stays the same, so zooming never resizes the PTY.
  const liveZoom = useStore(selectZoom);
  const zoom = useSettledZoom(liveZoom);
  const zoomRef = useRef(zoom);

  // Create xterm once per console.
  useEffect(() => {
    const z0 = zoomRef.current;
    const t = new Terminal({
      fontFamily: cssVar("--mono", "monospace"),
      fontSize: renderFont(useBoard.getState().settings.fontSize, z0),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: "#0b0c0f",
        foreground: cssVar("--text", "#e3e6ee"),
        cursor: cssVar("--accent", "#7c9cff"),
        cursorAccent: "#0b0c0f",
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
    const res = t.onResize(({ cols, rows }) => {
      terminalSizes.set(c.id, { cols, rows });
      void ipc.resize(c.id, cols, rows).catch(() => undefined);
    });
    let raf = 0;
    const doFit = () => {
      raf = 0;
      try {
        f.fit();
      } catch {
        /* host not laid out yet */
      }
    };
    fitNow.current = doFit;
    const ro = new ResizeObserver(() => {
      // a zoom-only change resizes the (counter-scaled) host too — keep the grid as is
      if (zoomChanging.current) return;
      if (!raf) raf = requestAnimationFrame(doFit);
    });
    ro.observe(outer.current!);
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

  // Re-rasterise when zoom settles (font × zoom), keeping cols/rows unchanged.
  useEffect(() => {
    zoomRef.current = zoom;
    const t = term.current;
    if (!t) return;
    const want = renderFont(fontSize, zoom);
    if (t.options.fontSize === want) return;
    const { cols, rows } = t;
    zoomChanging.current = true;
    t.options.fontSize = want;
    t.resize(cols, rows);
    requestAnimationFrame(() => requestAnimationFrame(() => (zoomChanging.current = false)));
  }, [zoom, fontSize]);

  // Live font-size changes from Settings → refit (grid may change).
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontSize = renderFont(fontSize, zoomRef.current);
    fitNow.current?.();
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
      if (launchInflight.has(c.id)) return;
      setBusy(true);
      setError(null);
      try {
        const ok = await launchConsole(c.id, resume, {
          cols: term.current?.cols,
          rows: term.current?.rows,
          // read the refs at call time — the terminal may have been recreated
          // (StrictMode remount) or disposed (console removed) while we awaited
          prepare: () => {
            try {
              fit.current?.fit();
            } catch {
              /* ignore */
            }
            term.current?.reset();
          },
        });
        if (ok) {
          if (await attach()) {
            setPhase("live");
            term.current?.focus();
          } else {
            setPhase("stopped");
          }
        }
      } catch (e) {
        setError(String(e));
        setPhase("stopped");
      } finally {
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
    if (launchInflight.has(c.id)) return;
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

  // Relaunched from outside (Dock "Resume all" / app-start auto-resume): the PTY came
  // up after our own attach failed — subscribe now that it is running.
  useEffect(() => {
    if (!running || phase === "live" || busy || launchInflight.has(c.id)) return;
    let cancelled = false;
    attach()
      .then((ok) => !cancelled && setPhase(ok ? "live" : "stopped"))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [running, phase, busy, attach, c.id]);

  useEffect(() => {
    if (!busy && phase === "live" && !running) setPhase("stopped");
  }, [running, phase, busy]);

  const resumable = canResume(c);
  const showOverlay = phase === "stopped" && !busy && !running;
  const cwdShown = c.cwd || resolvedCwd;

  return (
    <div className="terminal-wrap" onMouseDown={() => useBoard.getState().setFocused(c.id)}>
      <div ref={outer} className="terminal-host">
        <div
          ref={host}
          className="terminal-scale"
          style={{
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            transform: zoom === 1 ? undefined : `scale(${1 / zoom})`,
          }}
        />
      </div>
      {showOverlay && (
        <div className="console-overlay absolute inset-0 grid place-items-center bg-[#0b0c0f]/92" role="dialog" aria-label="Start console">
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.soft} className="flex min-w-[300px] max-w-[90%] flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-10 py-8 text-center shadow-[0_20px_50px_-20px_rgb(0_0_0/0.9)]">
            <span className="mb-1 grid size-14 place-items-center rounded-2xl border border-line-strong bg-black/30 shadow-[0_0_30px_-8px_var(--tint)]">
              <ConsoleAgentIcon agent={c.agent} size={30} />
            </span>
            <div className="text-[17px] font-semibold tracking-tight text-ink">{agentLabel(c.agent)}</div>
            <div className="max-w-full truncate font-mono text-[12px] text-ink-3" title={cwdShown}>
              {shortPath(cwdShown, 3) || "default folder"}
            </div>
            {exitCode !== undefined && (
              <div className="text-[12px] text-ink-3">Last run exited{exitCode !== null ? ` with code ${exitCode}` : ""}</div>
            )}
            {error && <div className="max-w-[360px] break-words text-[12px] text-danger">{error}</div>}
            <div className="mt-3 flex gap-2">
              {resumable && (
                <button
                  className="h-9 rounded-full bg-ink px-4 text-[13px] font-semibold text-bg transition hover:bg-white active:scale-95"
                  autoFocus
                  onClick={() => void start(true)}
                >
                  Resume last session
                </button>
              )}
              <button
                className={
                  resumable
                    ? "ring-pill !h-9"
                    : "h-9 rounded-full bg-ink px-4 text-[13px] font-semibold text-bg transition hover:bg-white active:scale-95"
                }
                style={resumable ? { ["--ring-a" as string]: "#56d8c9", ["--ring-b" as string]: "#8ea2ff" } : undefined}
                onClick={() => void start(false)}
              >
                Start new
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {busy && !running && (
        <div className="console-overlay busy absolute inset-0 grid place-items-center bg-bg/70 text-[13px] text-ink-2">
          <span className="flex items-center gap-2">
            <span className="size-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-ink" />
            Starting…
          </span>
        </div>
      )}
    </div>
  );
}

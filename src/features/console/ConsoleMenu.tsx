import { useEffect, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { activeWorkspace, useBoard } from "../../store/board";
import { ipc, submit } from "../../lib/ipc";
import type { ConsoleNode } from "../../lib/types";
import { canResume, relativeTime } from "./helpers";
import { terminalControls } from "./controls";
import { LoopEditor } from "../loops/LoopEditor";
import { AnimatePresence, motion } from "motion/react";
import { popVariants } from "../../lib/motion";
import { profilesFor } from "../settings/profiles";

interface Props {
  c: ConsoleNode;
  onRename: () => void;
  onClose: () => void;
}

/** The "…" button + dropdown + diagnostics popover. */
export function ConsoleMenu({ c, onRename, onClose }: Props) {
  const [open_, setOpen] = useState(false);
  const [diag, setDiag] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const running = useBoard((s) => s.runtime[c.id]?.running ?? false);
  const hooks = useBoard((s) => s.runtime[c.id]?.hooks);
  const memory = useBoard((s) => activeWorkspace(s.board).memory);
  const allProfiles = useBoard((s) => s.settings.profiles);
  const profiles = profilesFor(c.agent, allProfiles ?? []);

  const switchProfile = async (pid: string | undefined) => {
    if (pid === c.profile) return;
    // a different account means a different session store — never resume across accounts
    useBoard.getState().patchConsole(c.id, { profile: pid, agentSession: undefined });
    if (useBoard.getState().runtime[c.id]?.running) {
      const name = allProfiles.find((p) => p.id === pid)?.name ?? "the default login";
      if (await ask(`Restart "${c.title}" with ${name}?`, { title: "Switch account", kind: "info" })) {
        await ipc.kill(c.id).catch(() => undefined);
        await terminalControls.get(c.id)?.start(false);
      }
    }
  };

  useEffect(() => {
    if (!open_ && !diag && !loopOpen) return;
    const down = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setDiag(false);
        setLoopOpen(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setDiag(false);
        setLoopOpen(false);
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open_, diag, loopOpen]);

  // Focus first item when the menu opens; arrow-key navigation.
  useEffect(() => {
    if (open_) root.current?.querySelector<HTMLElement>(".menu-item:not(:disabled)")?.focus();
  }, [open_]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const run = (f: () => void | Promise<void>) => () => {
    setOpen(false);
    void Promise.resolve(f()).catch(() => undefined);
  };

  const changeFolder = async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: c.cwd || undefined });
    if (typeof picked !== "string" || picked === c.cwd) return;
    useBoard.getState().patchConsole(c.id, { cwd: picked });
    if (useBoard.getState().runtime[c.id]?.running) {
      const yes = await ask(`Restart "${c.title}" now in ${picked}?`, {
        title: "Change folder",
        kind: "info",
      });
      if (yes) {
        await ipc.kill(c.id).catch(() => undefined);
        await terminalControls.get(c.id)?.start(false);
      }
    }
  };

  const stop = async () => {
    if (!(await ask(`Stop "${c.title}"?`, { title: "Stop console", kind: "warning" }))) return;
    await ipc.kill(c.id).catch(() => undefined);
  };

  const copyTranscript = async () => {
    const t = await ipc.transcript(c.id);
    if (t) await navigator.clipboard.writeText(t);
  };

  return (
    <div className="console-menu-root nodrag" ref={root} onKeyDown={onMenuKey}>
      <button
        className="grid size-7 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95 aria-expanded:bg-surface-3 aria-expanded:text-ink"
        title="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open_}
        onClick={() => {
          setDiag(false);
          setLoopOpen(false);
          setOpen((v) => !v);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {loopOpen && <LoopEditor c={c} onClose={() => setLoopOpen(false)} />}
      <AnimatePresence>
      {open_ && (
        <motion.div
          key="menu"
          variants={popVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ transformOrigin: "top right" }}
          className="menu console-menu glass !rounded-xl !border-line !bg-transparent"
          role="menu"
        >
          <button className="menu-item" role="menuitem" onClick={run(onRename)}>
            Rename
          </button>
          <button className="menu-item" role="menuitem" onClick={run(changeFolder)}>
            Change folder…
          </button>
          <button className="menu-item" role="menuitem" onClick={run(() => terminalControls.get(c.id)?.start(false))}>
            Restart
          </button>
          {c.agent.kind === "claudeCode" && (
            <button
              className="menu-item"
              role="menuitemcheckbox"
              aria-checked={!!c.lead}
              onClick={run(async () => {
                useBoard.getState().patchConsole(c.id, { lead: !c.lead });
                if (useBoard.getState().runtime[c.id]?.running) {
                  const yes = await ask(
                    c.lead ? `Restart "${c.title}" without orchestrator tools?` : `Restart "${c.title}" as orchestrator lead? It will be able to message, read and spawn other consoles.`,
                    { title: "Orchestrator lead", kind: "info" },
                  );
                  if (yes) {
                    await ipc.kill(c.id).catch(() => undefined);
                    await terminalControls.get(c.id)?.start(false);
                  }
                }
              })}
            >
              {c.lead ? "Remove lead role" : "Make orchestrator lead"}
            </button>
          )}
          {profiles.length > 0 && (
            <>
              <div className="menu-sep" role="separator" />
              <div className="px-3 pb-0.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">Account</div>
              {[undefined, ...profiles.map((p) => p.id)].map((pid) => {
                const p = profiles.find((x) => x.id === pid);
                return (
                  <button
                    key={pid ?? "default"}
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={c.profile === pid}
                    onClick={run(() => switchProfile(pid))}
                  >
                    <span className="mr-2 inline-block size-2 rounded-full" style={{ background: p?.color ?? "var(--color-ink-3)" }} />
                    {p?.name ?? "Default login"}
                    {c.profile === pid && <span className="ml-auto pl-3 text-accent">✓</span>}
                  </button>
                );
              })}
              <div className="menu-sep" role="separator" />
            </>
          )}
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setLoopOpen(true);
            }}
          >
            {c.loop?.enabled ? "Loop (running)…" : "Loop…"}
          </button>
          <button
            className="menu-item"
            role="menuitem"
            disabled={!canResume(c)}
            onClick={run(() => terminalControls.get(c.id)?.start(true))}
          >
            Resume last session
          </button>
          <button
            className="menu-item"
            role="menuitem"
            disabled={!memory.trim() || !running}
            onClick={run(() => submit(c.id, memory))}
          >
            Send memory
          </button>
          <button className="menu-item" role="menuitem" onClick={run(copyTranscript)}>
            Copy transcript
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDiag(true);
            }}
          >
            Diagnostics
          </button>
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" disabled={!running} onClick={run(stop)}>
            Stop
          </button>
          <button className="menu-item danger" role="menuitem" onClick={run(onClose)}>
            Remove from board
          </button>
        </motion.div>
      )}
      </AnimatePresence>
      {diag && (
        <div className="menu console-diag glass animate-pop !rounded-xl !border-line !bg-transparent" role="dialog" aria-label="Diagnostics">
          <div className="menu-label">Claude hook events</div>
          {hooks && hooks.length > 0 ? (
            <ul>
              {[...hooks].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span>{h.event}</span>
                  <span className="when">{relativeTime(h.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="console-diag-empty">No hook events received yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { activeWorkspace, useBoard } from "../../store/board";
import { ipc, submit } from "../../lib/ipc";
import type { ConsoleNode } from "../../lib/types";
import { canResume, relativeTime } from "./helpers";
import { terminalControls } from "./controls";

interface Props {
  c: ConsoleNode;
  onRename: () => void;
  onClose: () => void;
}

/** The "…" button + dropdown + diagnostics popover. */
export function ConsoleMenu({ c, onRename, onClose }: Props) {
  const [open_, setOpen] = useState(false);
  const [diag, setDiag] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const running = useBoard((s) => s.runtime[c.id]?.running ?? false);
  const hooks = useBoard((s) => s.runtime[c.id]?.hooks);
  const memory = useBoard((s) => activeWorkspace(s.board).memory);

  useEffect(() => {
    if (!open_ && !diag) return;
    const down = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setDiag(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setDiag(false);
      }
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open_, diag]);

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
          setOpen((v) => !v);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open_ && (
        <div className="menu console-menu glass animate-pop !rounded-xl !border-line !bg-transparent" role="menu">
          <button className="menu-item" role="menuitem" onClick={run(onRename)}>
            Rename
          </button>
          <button className="menu-item" role="menuitem" onClick={run(changeFolder)}>
            Change folder…
          </button>
          <button className="menu-item" role="menuitem" onClick={run(() => terminalControls.get(c.id)?.start(false))}>
            Restart
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
        </div>
      )}
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

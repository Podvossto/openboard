import { motion } from "motion/react";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { useEffect, useRef, useState } from "react";
import { ask } from "../../lib/dialog";
import { activeWorkspace, useBoard } from "../../store/board";
import { submit } from "../../lib/ipc";
import { debounce } from "../../lib/debounce";
import "../settings/settings.css";
import { MEMORY_MAX, MEMORY_SNIPPETS, insertSnippet } from "../presets/presets";

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const wsName = useBoard((s) => activeWorkspace(s.board).name);
  const wsId = useBoard((s) => activeWorkspace(s.board).id);
  const auto = useBoard((s) => !!activeWorkspace(s.board).memoryAuto);
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => activeWorkspace(useBoard.getState().board).memory);
  const [info, setInfo] = useState<string | null>(null);
  const save = useRef(debounce((v: string) => useBoard.getState().setMemory(v), 400));
  const latest = useRef(text);
  latest.current = text;

  // workspace switched while open → reload its memory
  const lastWs = useRef(wsId);
  useEffect(() => {
    if (lastWs.current === wsId) return;
    lastWs.current = wsId;
    setText(activeWorkspace(useBoard.getState().board).memory);
  }, [wsId]);

  // flush pending edit on close
  useEffect(() => {
    return () => {
      const cur = activeWorkspace(useBoard.getState().board).memory;
      if (cur !== latest.current && lastWs.current === activeWorkspace(useBoard.getState().board).id)
        useBoard.getState().setMemory(latest.current);
    };
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const sendAll = async () => {
    const st = useBoard.getState();
    const targets = activeWorkspace(st.board).consoles.filter((c) => st.runtime[c.id]?.running);
    if (!text.trim()) return setInfo("Memory is empty.");
    if (!targets.length) return setInfo("No running consoles.");
    const ok = await ask(`Send this memory to ${targets.length} running console${targets.length === 1 ? "" : "s"}?`, {
      title: "Send memory",
      kind: "info",
    });
    if (!ok) return;
    await Promise.all(targets.map((c) => submit(c.id, text).catch(() => undefined)));
    setInfo(`Sent to ${targets.length} console${targets.length === 1 ? "" : "s"}.`);
  };

  return (
    <motion.div className="sheet-backdrop" variants={fadeVariants} initial="initial" animate="animate" exit="exit" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.aside variants={sheetVariants} className="panel sheet" role="dialog" aria-label="Workspace memory">
        <header className="sheet-head">
          <h2>Memory <span className="sheet-sub">· {wsName}</span></h2>
          <button className="btn icon ghost" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="field sheet-body">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-3" htmlFor="memory-auto">
            <input
              id="memory-auto"
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
              checked={auto}
              onChange={(e) => useBoard.getState().setMemoryAuto(e.target.checked)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-ink">Share with new agents automatically</span>
              <span className="text-[11.5px] text-ink-3">
                Every Claude console started in “{wsName}” gets these notes in its system prompt — no need to send them each time. Already-running consoles: use “Send to all running”.
              </span>
            </span>
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Insert snippet">
            <span className="mr-1 text-[11px] font-semibold text-ink-3">Insert:</span>
            {MEMORY_SNIPPETS.map((sn) => (
              <button
                key={sn.label}
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  const at = area.current?.selectionStart ?? text.length;
                  const r = insertSnippet(text, at, sn.text);
                  setText(r.text);
                  save.current(r.text);
                  requestAnimationFrame(() => {
                    area.current?.focus();
                    area.current?.setSelectionRange(r.caret, r.caret);
                  });
                }}
              >
                + {sn.label}
              </button>
            ))}
          </div>
          <label htmlFor="memory-text" className="mt-3">
            Notes
          </label>
          <textarea
            id="memory-text"
            ref={area}
            className="input memory-text"
            value={text}
            placeholder={"What every agent in this workspace should know:\n- how to run / test the project\n- conventions and things not to touch\n- links (repo, docs, staging)"}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              save.current(e.target.value);
            }}
          />
          <span className={`help flex justify-between ${text.length > MEMORY_MAX ? "text-warn" : ""}`} data-testid="memory-count">
            <span>{auto ? "Auto-shared with new Claude consoles." : "Not shared automatically — send it from a console's menu or below."}</span>
            <span>
              {text.length.toLocaleString()} / {MEMORY_MAX.toLocaleString()}
              {text.length > MEMORY_MAX ? " — agents get the first part only" : ""}
            </span>
          </span>
        </div>
        <footer className="sheet-foot">
          {info && <span className="sheet-info" role="status">{info}</span>}
          <button className="btn primary" onClick={() => void sendAll()}>Send to all running</button>
        </footer>
      </motion.aside>
    </motion.div>
  );
}

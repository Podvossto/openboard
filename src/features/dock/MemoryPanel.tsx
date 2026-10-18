import { motion } from "motion/react";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { activeWorkspace, useBoard } from "../../store/board";
import { submit } from "../../lib/ipc";
import { debounce } from "../../lib/debounce";
import "../settings/settings.css";

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const wsName = useBoard((s) => activeWorkspace(s.board).name);
  const wsId = useBoard((s) => activeWorkspace(s.board).id);
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
          <label htmlFor="memory-text">Notes</label>
          <textarea
            id="memory-text"
            className="input memory-text"
            value={text}
            placeholder="Conventions, commands, URLs…"
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              save.current(e.target.value);
            }}
          />
          <span className="help">
            Shared notes for this workspace. Never sent automatically — use “Send memory” on a console or “Send to all”.
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

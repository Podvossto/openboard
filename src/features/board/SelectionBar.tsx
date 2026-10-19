// Floating bar for a multi-selection (Shift+drag box or Shift/Ctrl+click):
// Delete (asks first when a running console is in it), Group (consoles), Clear.
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useOnSelectionChange, useReactFlow, type Node } from "@xyflow/react";
import { ask } from "../../lib/dialog";
import { ipc } from "../../lib/ipc";
import { popVariants } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import { useBoard } from "../../store/board";
import { summarizeSelection, type SelKind } from "./selection";

export function SelectionBar({ onGroup }: { onGroup: (consoleIds: string[]) => void }) {
  const rf = useReactFlow();
  const [sel, setSel] = useState<{ id: string; type: SelKind }[]>([]);

  useOnSelectionChange({
    onChange: useCallback(({ nodes }: { nodes: Node[] }) => setSel(nodes.map((n) => ({ id: n.id, type: n.type as SelKind }))), []),
  });

  const clear = useCallback(() => {
    rf.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, [rf]);

  const remove = useCallback(async () => {
    const st = useBoard.getState();
    const running = sel.filter((s) => s.type === "console" && st.runtime[s.id]?.running);
    const label = summarizeSelection(sel);
    const msg = running.length
      ? `Delete ${label}? ${running.length} running console${running.length === 1 ? "" : "s"} will stop.`
      : `Delete ${label}?`;
    if (!(await ask(msg, { title: "Delete selection", kind: "warning" }).catch(() => false))) return;
    await Promise.all(running.map((s) => ipc.kill(s.id).catch(() => undefined)));
    clear(); // hide the bar now — don't wait for React Flow's change event after the exit animation
    // groups/sections last: removing a frame first would re-home its members
    const order: SelKind[] = ["console", "tile", "group", "section"];
    for (const k of order) for (const s of sel.filter((x) => x.type === k)) removeAnimated(k, s.id);
    setSel([]);
  }, [sel, clear]);

  // Delete / Backspace with a selection (never while typing in a field or a terminal)
  useEffect(() => {
    if (sel.length < 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest(".xterm, .console-body, .tile-body"))) return;
      e.preventDefault();
      void remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, remove]);

  const consoles = sel.filter((s) => s.type === "console").map((s) => s.id);
  const show = sel.length >= 2;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="selbar"
          variants={popVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="glass absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-2 py-1.5 shadow-xl"
          role="toolbar"
          aria-label="Selection"
        >
          <span className="px-2 text-[12px] font-semibold text-ink" data-testid="sel-count">
            {summarizeSelection(sel)}
          </span>
          {consoles.length >= 1 && (
            <button className="btn sm" onClick={() => onGroup(consoles)} title="Put the selected consoles in a new group">
              Group
            </button>
          )}
          <button className="btn sm danger" onClick={() => void remove()} title="Delete (Del)">
            Delete
          </button>
          <button className="btn ghost sm" onClick={clear} aria-label="Clear selection" title="Clear (Esc)">
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

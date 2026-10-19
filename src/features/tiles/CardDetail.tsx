// Kanban card detail: edit title / details / column, see who made it and when.
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { fadeVariants, popVariants } from "../../lib/motion";
import type { KanbanCard } from "../../lib/types";
import { cardWhen } from "./logic";

export function CardDetail({
  card,
  column,
  columns,
  onSave,
  onDelete,
  onClose,
}: {
  card: KanbanCard;
  column: string;
  columns: { id: string; name: string }[];
  onSave: (patch: { text: string; desc: string }, toCol?: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(card.text);
  const [desc, setDesc] = useState(card.desc ?? "");
  const [col, setCol] = useState(columns.find((c) => c.name === column)?.id ?? "");
  const latest = useRef({ text, desc, col });
  latest.current = { text, desc, col };

  const save = () => {
    const l = latest.current;
    onSave({ text: l.text, desc: l.desc }, l.col);
  };
  const close = () => {
    save();
    onClose();
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const created = cardWhen(card.createdAt);
  const updated = cardWhen(card.updatedAt);

  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/50 backdrop-blur-[2px]"
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        variants={popVariants}
        initial="initial"
        animate="animate"
        role="dialog"
        aria-label="Card details"
        className="glass w-[520px] max-w-[92vw] rounded-2xl p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">Card</span>
          <select
            aria-label="Column"
            className="input h-7 w-auto py-0 text-[12px]"
            value={col}
            onChange={(e) => setCol(e.target.value)}
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <button className="btn icon ghost" aria-label="Close card" title="Close (Esc)" onClick={close}>
            ×
          </button>
        </div>
        <input
          aria-label="Card title"
          className="input mb-3 w-full text-[15px] font-semibold"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && close()}
        />
        <label className="mb-1 block text-[11.5px] font-semibold text-ink-3" htmlFor="card-desc">
          Details
        </label>
        <textarea
          id="card-desc"
          className="input min-h-36 w-full resize-y text-[13px] leading-relaxed"
          placeholder="Acceptance criteria, links, notes for the agent…"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]" data-testid="card-meta">
          <dt className="text-ink-3">Created</dt>
          <dd className="m-0 text-ink-2">
            {created || "—"}
            {card.createdBy ? <> · by <strong className="text-ink">{card.createdBy}</strong></> : null}
          </dd>
          <dt className="text-ink-3">Last edit</dt>
          <dd className="m-0 text-ink-2">
            {updated || "never"}
            {card.updatedBy ? <> · by <strong className="text-ink">{card.updatedBy}</strong></> : null}
          </dd>
          <dt className="text-ink-3">Id</dt>
          <dd className="m-0 font-mono text-[11px] text-ink-3">{card.id}</dd>
        </dl>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn ghost sm text-danger" onClick={onDelete}>
            Delete card
          </button>
          <span className="flex-1" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

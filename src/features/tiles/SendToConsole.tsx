import { useCallback, useRef, useState } from "react";
import { activeWorkspace, useBoard } from "../../store/board";
import { submit } from "../../lib/ipc";
import { useDismiss } from "../dock/useDismiss";

/** Small "Send ▸" button: pick a running console and submit `text()` to it. */
export function SendToConsole({ text, disabled }: { text: () => string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [sent, setSent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, close);
  const consoles = useBoard((s) => activeWorkspace(s.board).consoles);
  const runtime = useBoard((s) => s.runtime);
  const live = consoles.filter((c) => runtime[c.id]?.running);
  return (
    <div className="relative" ref={ref}>
      <button
        className="h-6 rounded-full border border-line-strong px-2.5 text-[11.5px] font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-40"
        disabled={disabled}
        aria-expanded={open}
        title="Send to a console"
        onClick={() => setOpen((o) => !o)}
      >
        {sent ? `Sent → ${sent}` : "Send ▸"}
      </button>
      {open && (
        <div role="menu" className="glass animate-pop absolute right-0 top-[calc(100%+6px)] z-30 min-w-44 rounded-xl p-1">
          {live.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-3">No running console</div>}
          {live.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink"
              onClick={() => {
                void submit(c.id, text());
                setOpen(false);
                setSent(c.title);
                window.setTimeout(() => setSent(null), 2500);
              }}
            >
              @{c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

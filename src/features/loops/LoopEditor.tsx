import { useState } from "react";
import type { ConsoleNode, LoopConfig, LoopTrigger } from "../../lib/types";
import { useBoard } from "../../store/board";
import { DEFAULT_LOOP } from "./schedule";

const KINDS: { kind: LoopTrigger["kind"]; label: string }[] = [
  { kind: "idle", label: "When idle" },
  { kind: "interval", label: "Every N min" },
  { kind: "output", label: "On output" },
];

/** Loop settings popover for one console (opened from its "…" menu). */
export function LoopEditor({ c, onClose }: { c: ConsoleNode; onClose: () => void }) {
  const [d, setD] = useState<LoopConfig>(() => ({ ...DEFAULT_LOOP, ...c.loop }));
  const t = d.trigger;
  const set = (p: Partial<LoopConfig>) => setD((x) => ({ ...x, ...p }));
  const setKind = (kind: LoopTrigger["kind"]) =>
    set({
      trigger: kind === "idle" ? { kind, seconds: 60 } : kind === "interval" ? { kind, minutes: 10 } : { kind, match: "" },
    });
  const valid = d.message.trim() && (t.kind !== "output" || t.match.trim());

  const save = (enabled: boolean) => {
    useBoard.getState().patchConsole(c.id, {
      loop: { ...d, enabled, runs: enabled && !c.loop?.enabled ? 0 : d.runs, stoppedReason: undefined },
    });
    onClose();
  };

  const field = "h-9 w-full rounded-xl border border-line bg-bg/70 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70";
  const label = "mb-1 block text-[11.5px] font-semibold text-ink-2";

  return (
    <div role="dialog" aria-label="Loop" className="menu glass animate-pop !w-[340px] !rounded-2xl !border-line !bg-transparent !p-4 text-left">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">Loop</span>
        {c.loop?.enabled && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok">running · {c.loop.runs} done</span>}
        {!c.loop?.enabled && c.loop?.stoppedReason && (
          <span className="min-w-0 truncate rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-3" title={c.loop.stoppedReason}>
            {c.loop.stoppedReason}
          </span>
        )}
      </div>

      <span className={label}>Trigger</span>
      <div className="seg mb-3 inline-flex gap-1 rounded-full border border-line bg-bg/70 p-1">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            className={`h-7 rounded-full px-3 text-[12px] font-medium transition ${t.kind === k.kind ? "bg-surface-3 font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}
            aria-pressed={t.kind === k.kind}
            onClick={() => setKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mb-3">
        {t.kind === "idle" && (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            After
            <input type="number" min={5} aria-label="Idle seconds" className={`${field} !w-20`} value={t.seconds} onChange={(e) => set({ trigger: { kind: "idle", seconds: Math.max(5, +e.target.value || 5) } })} />
            seconds resting
          </label>
        )}
        {t.kind === "interval" && (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Every
            <input type="number" min={1} aria-label="Interval minutes" className={`${field} !w-20`} value={t.minutes} onChange={(e) => set({ trigger: { kind: "interval", minutes: Math.max(1, +e.target.value || 1) } })} />
            minutes (only when resting)
          </label>
        )}
        {t.kind === "output" && (
          <input aria-label="Output contains" className={field} placeholder="Output contains… e.g. tests failed" value={t.match} onChange={(e) => set({ trigger: { kind: "output", match: e.target.value } })} />
        )}
      </div>

      <label className={label} htmlFor={`loop-msg-${c.id}`}>Send</label>
      <textarea
        id={`loop-msg-${c.id}`}
        rows={2}
        className={`${field} mb-3 h-auto resize-none py-2`}
        placeholder="continue"
        value={d.message}
        onChange={(e) => set({ message: e.target.value })}
      />

      <label className={label} htmlFor={`loop-goal-${c.id}`}>
        Stop when goal is met <span className="font-normal text-ink-3">(optional · checked with Claude)</span>
      </label>
      <input id={`loop-goal-${c.id}`} className={`${field} mb-3`} placeholder="e.g. all tests pass" value={d.goal} onChange={(e) => set({ goal: e.target.value })} />

      <label className="mb-4 flex items-center gap-2 text-[13px] text-ink-2">
        Max runs
        <input type="number" min={0} aria-label="Max runs" className={`${field} !w-20`} value={d.maxRuns} onChange={(e) => set({ maxRuns: Math.max(0, +e.target.value || 0) })} />
        <span className="text-[11.5px] text-ink-3">0 = no limit</span>
      </label>

      <div className="flex justify-end gap-2">
        {c.loop?.enabled ? (
          <button className="h-9 rounded-full px-4 text-[13px] font-semibold text-danger transition hover:bg-danger/10" onClick={() => save(false)}>
            Stop loop
          </button>
        ) : (
          <button className="h-9 rounded-full px-4 text-[13px] font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink" onClick={onClose}>
            Cancel
          </button>
        )}
        <button
          className="h-9 rounded-full bg-ink px-4 text-[13px] font-semibold text-bg transition hover:bg-white active:scale-95 disabled:opacity-40"
          disabled={!valid}
          onClick={() => save(true)}
        >
          {c.loop?.enabled ? "Update" : "Start loop"}
        </button>
      </div>
    </div>
  );
}

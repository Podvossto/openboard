// Orchestrator HUD: who each lead drives (and which tiles each agent is linked to), with live
// status, how many tasks were sent and when. Toggle from the bottom-right; hidden when empty.
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { popVariants } from "../../lib/motion";
import { activeWorkspace, displayStatus, useBoard } from "../../store/board";
import { STATUS_COLOR, STATUS_LABEL } from "../console/statusStyle";
import { LINK_COLOR } from "../board/edges";
import { hudRows } from "./hud";
import { relativeTime } from "../console/helpers";
import { unlinkConsole } from "./linking";

export function OrchestratorHud() {
  const [open, setOpen] = useState(true);
  const ws = useBoard((s) => activeWorkspace(s.board));
  const runtime = useBoard((s) => s.runtime);
  const contacted = useBoard((s) => s.contacted);
  const flashes = useBoard((s) => s.flashes);
  const rows = useMemo(() => hudRows(ws.consoles, ws.tiles ?? [], contacted, flashes, ws.groups), [ws, contacted, flashes]);
  if (rows.length === 0) return null;

  const focus = (id: string) => useBoard.getState().setFocused(id);
  const dot = (id: string) => {
    const st = displayStatus(runtime[id]);
    return <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} title={STATUS_LABEL[st]} />;
  };

  return (
    <div className="pointer-events-auto absolute bottom-20 right-4 z-30 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.section
            key="hud"
            variants={popVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: "bottom right" }}
            className="glass w-[300px] max-h-[50vh] overflow-y-auto rounded-2xl p-3 shadow-2xl"
            role="region"
            aria-label="Orchestrator"
          >
            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">Orchestrator</div>
            <div className="flex flex-col gap-3">
              {rows.map((r) => (
                <div
                  key={r.id}
                  data-hud={r.id}
                  className="rounded-xl border px-2.5 py-2"
                  style={{ borderColor: `${r.color}55`, background: `${r.color}0f` }}
                >
                  {r.lead && (
                    <div className="mb-1.5 flex items-center gap-1.5" data-hud-team={r.team}>
                      <span className="size-2.5 rounded-full" style={{ background: r.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: r.color }}>
                        {r.team}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-ink-3">
                        {r.workers.length} {r.workers.length === 1 ? "member" : "members"}
                      </span>
                    </div>
                  )}
                  <button className="flex w-full items-center gap-2 text-left" onClick={() => focus(r.id)}>
                    {dot(r.id)}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{r.title}</span>
                    {r.lead && <span className="rounded-md border border-warn/45 bg-warn/10 px-1.5 text-[10px] font-bold uppercase text-warn">Lead</span>}
                  </button>
                  <ul className="m-0 mt-1 list-none space-y-0.5 border-l border-line/70 pl-3">
                    {r.workers.map((w) => (
                      <li key={w.id} className="flex items-center gap-2 text-[12px] text-ink-2" data-hud-worker={w.id}>
                        {ws.consoles.find((x) => x.id === r.id)?.links?.includes(w.id) && (
                          <button
                            className="grid size-4 shrink-0 place-items-center rounded-full text-ink-3 hover:text-danger"
                            aria-label={`Remove ${w.title} from ${r.team}`}
                            title="Remove from team"
                            onClick={() => void unlinkConsole(r.id, w.id)}
                          >
                            ×
                          </button>
                        )}
                        {dot(w.id)}
                        <button className="min-w-0 flex-1 truncate text-left hover:text-ink" onClick={() => focus(w.id)}>
                          {w.title}
                        </button>
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-3" title="tasks sent by the lead">
                          {w.sent > 0 ? `${w.sent}× · ${relativeTime(w.last)}` : "—"}
                        </span>
                      </li>
                    ))}
                    {r.tiles.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-[12px] text-ink-2" data-hud-tile={t.id}>
                        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: LINK_COLOR[t.kind] }} />
                        <span className="min-w-0 flex-1 truncate">
                          {t.title} <span className="text-ink-3">· {t.kind}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-3" title="edits by the agent">
                          {t.edits > 0 ? `${t.edits}× · ${relativeTime(t.last)}` : "linked"}
                        </span>
                        <button
                          className="grid size-5 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-danger/20 hover:text-danger"
                          aria-label={`Unlink ${t.title} from ${r.title}`}
                          title="Unlink (also: right-click the link line)"
                          onClick={() => void unlinkConsole(r.id, t.id)}
                        >
                          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
                            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <button
        className="glass flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ink-2 transition hover:text-ink"
        aria-expanded={open}
        aria-label="Orchestrator HUD"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M9 11l6-4M9 13l6 4" />
        </svg>
        {rows.length}
      </button>
    </div>
  );
}

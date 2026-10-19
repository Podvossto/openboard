// Top-right "needs you" inbox: every console waiting for an approval / answer, across all
// workspaces. Click → switch workspace + fly to the console. An item disappears on its own
// once the agent leaves needsYou (approved, answered, or exited).
import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReactFlow } from "@xyflow/react";
import { spring } from "../../lib/motion";
import { displayStatus, useBoard } from "../../store/board";
import { ConsoleAgentIcon } from "../../components/AgentIcon";
import { needsYouItems } from "./inbox";
import { relativeTime } from "../console/helpers";

export function NeedsYouInbox() {
  const board = useBoard((s) => s.board);
  const runtime = useBoard((s) => s.runtime);
  const since = useBoard((s) => s.needsSince);
  const rf = useReactFlow();
  const items = useMemo(() => needsYouItems(board, (id) => displayStatus(runtime[id]), since), [board, runtime, since]);

  const go = (wsId: string, id: string) => {
    const st = useBoard.getState();
    if (st.board.active !== wsId) st.setActive(wsId);
    st.setFocused(id);
    // the canvas remounts on a workspace switch — wait a frame for the node to exist
    setTimeout(() => void rf.fitView({ nodes: [{ id }], duration: 350, maxZoom: 1 }), st.board.active === wsId ? 0 : 120);
  };

  return (
    <div className="pointer-events-none fixed right-4 top-[68px] z-[60] flex w-[300px] flex-col gap-2" role="region" aria-label="Needs you">
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.button
            key={it.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1, transition: spring.snappy }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.16 } }}
            className="glass pointer-events-auto flex w-full items-center gap-2.5 rounded-xl border border-warn/40 px-3 py-2 text-left shadow-xl transition hover:border-warn/70"
            data-needs={it.id}
            aria-label={`${it.title} needs you — go to console`}
            onClick={() => go(it.wsId, it.id)}
          >
            <span className="relative grid size-7 shrink-0 place-items-center rounded-lg bg-warn/15">
              <ConsoleAgentIcon agent={it.agent} size={14} />
              <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-warn ring-2 ring-surface" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-ink">{it.title}</span>
              <span className="block truncate text-[11px] text-ink-3">
                needs approval or an answer{it.wsName ? ` · ${it.wsName}` : ""}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{it.since ? relativeTime(it.since) : ""}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

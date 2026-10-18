import { useEffect } from "react";
import { ipc, submit } from "../../lib/ipc";
import type { LoopConfig } from "../../lib/types";
import { useBoard } from "../../store/board";
import { newSince } from "./diffTail";
import { decide } from "./schedule";

const TICK_MS = 5_000;

/** Runs enabled console loops (all workspaces). Mounted once in App. */
export function useLoops() {
  useEffect(() => {
    const restingSince = new Map<string, number>();
    const lastTail = new Map<string, string>();
    const busy = new Set<string>();

    // track when each console became "resting"
    const unsub = useBoard.subscribe((s, prev) => {
      if (s.runtime === prev.runtime) return;
      for (const [id, r] of Object.entries(s.runtime)) {
        const was = prev.runtime[id]?.status;
        if (r.status === "resting" && was !== "resting") restingSince.set(id, Date.now());
        if (r.status !== "resting") restingSince.delete(id);
      }
    });

    const patchLoop = (id: string, patch: Partial<LoopConfig>) => {
      const c = findConsole(id);
      if (c?.loop) useBoard.getState().patchConsole(id, { loop: { ...c.loop, ...patch } });
    };

    const tick = async () => {
      const st = useBoard.getState();
      const all = st.board.workspaces.flatMap((w) => w.consoles);
      for (const c of all) {
        const cfg = c.loop;
        if (!cfg?.enabled || busy.has(c.id)) continue;
        const r = st.runtime[c.id];
        let newOutput = "";
        if (cfg.trigger.kind === "output" && r?.running) {
          const tail = (await ipc.transcript(c.id).catch(() => null)) ?? "";
          const had = lastTail.has(c.id);
          newOutput = had ? newSince(lastTail.get(c.id)!, tail) : ""; // first look = baseline only
          lastTail.set(c.id, tail);
        }
        const d = decide(cfg, {
          now: Date.now(),
          status: r?.status ?? "exited",
          running: !!r?.running,
          restingSince: restingSince.get(c.id),
          newOutput,
        });
        if (!d.fire) {
          if (d.reason === "max runs reached") patchLoop(c.id, { enabled: false, stoppedReason: "Reached max runs" });
          continue;
        }
        busy.add(c.id);
        try {
          if (cfg.goal.trim() && cfg.runs > 0) {
            const v = await ipc.loopGoalCheck(c.id, c.title, cfg.goal);
            if (v.done) {
              patchLoop(c.id, { enabled: false, stoppedReason: `Goal met: ${v.reason}` });
              continue;
            }
          }
          await submit(c.id, cfg.message);
          // restart the idle clock: a console that stays "resting" must wait a full period again
          restingSince.set(c.id, Date.now());
          patchLoop(c.id, { runs: cfg.runs + 1, lastRunAt: Date.now(), stoppedReason: undefined });
        } catch (e) {
          patchLoop(c.id, { enabled: false, stoppedReason: `Error: ${String(e)}` });
        } finally {
          busy.delete(c.id);
        }
      }
    };

    const t = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      window.clearInterval(t);
      unsub();
    };
  }, []);
}

function findConsole(id: string) {
  for (const w of useBoard.getState().board.workspaces) {
    const c = w.consoles.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

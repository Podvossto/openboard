import { useEffect } from "react";
import { events, ipc, submit } from "../../lib/ipc";
import type { AgentKind } from "../../lib/types";
import { useBoard } from "../../store/board";
import { createConsole } from "../../lib/actions";
import { agentShort } from "../../store/board";

const AGENTS: Record<string, AgentKind> = {
  claude: { kind: "claudeCode" },
  codex: { kind: "codex" },
  shell: { kind: "custom", program: "" },
};

/** Keeps the backend roster in sync and serves lead-console requests (spawn, activity pulses). */
export function useOrchestrator() {
  useEffect(() => {
    // roster → backend (all workspaces, so a lead can reach any console)
    let last = "";
    const push = () => {
      const s = useBoard.getState();
      const roster = s.board.workspaces.flatMap((w) =>
        w.consoles.map((c) => ({
          id: c.id,
          title: c.title,
          agent: agentShort(c.agent),
          group: w.groups.find((g) => g.id === c.group)?.name,
          lead: !!c.lead,
          links: (c.links ?? [])
            .map((tid) => (w.tiles ?? []).find((t) => t.id === tid))
            .filter((t): t is NonNullable<typeof t> => !!t)
            .map((t) => ({ id: t.id, kind: t.kind, title: t.title })),
        })),
      );
      const key = JSON.stringify(roster);
      if (key === last) return;
      last = key;
      void ipc.syncRoster(roster).catch(() => undefined);
    };
    push();
    const unsub = useBoard.subscribe(push);

    const pending = new Map<string, string>(); // new console id → first task
    const offRuntime = useBoard.subscribe((s, prev) => {
      if (s.runtime === prev.runtime) return;
      for (const [id, task] of pending) {
        const r = s.runtime[id];
        if (r?.running && r.status === "resting") {
          pending.delete(id);
          void submit(id, task);
        }
      }
    });

    const offSpawn = events.onOrchestratorSpawn(async ({ from, agent, title, task }) => {
      const a = AGENTS[agent] ?? AGENTS.claude!;
      const st = useBoard.getState();
      const lead = st.board.workspaces.flatMap((w) => w.consoles).find((c) => c.id === from);
      const id = await createConsole(a, { title, cwd: lead?.cwd ?? "" });
      useBoard.getState().flash(from, id, "lead");
      if (task.trim()) pending.set(id, task);
    });

    const offSent = events.onOrchestratorSent(({ from, to }) => {
      useBoard.getState().pulse(to);
      useBoard.getState().flash(from, to, "lead");
    });

    return () => {
      unsub();
      offRuntime();
      void offSpawn.then((f) => f());
      void offSent.then((f) => f());
    };
  }, []);
}

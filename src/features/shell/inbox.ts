// Pure: build the needs-you inbox list (unit-tested).
import type { AgentKind, Board, Status } from "../../lib/types";

export interface InboxItem {
  id: string;
  title: string;
  agent: AgentKind;
  wsId: string;
  /** workspace name, only when there is more than one workspace */
  wsName?: string;
  since?: number;
}

/** Consoles whose status is needsYou, oldest first (the one waiting longest on top). */
export function needsYouItems(board: Board, status: (id: string) => Status, since: Record<string, number>): InboxItem[] {
  const many = board.workspaces.length > 1;
  return board.workspaces
    .flatMap((w) =>
      w.consoles
        .filter((c) => status(c.id) === "needsYou")
        .map((c) => ({ id: c.id, title: c.title, agent: c.agent, wsId: w.id, wsName: many ? w.name : undefined, since: since[c.id] })),
    )
    .sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
}

/** Next `needsSince` map: stamp consoles that just entered needsYou, drop the ones that left. */
export function trackNeedsSince(prev: Record<string, number>, needing: string[], now: number): Record<string, number> {
  const next: Record<string, number> = {};
  for (const id of needing) next[id] = prev[id] ?? now;
  const same = Object.keys(prev).length === needing.length && needing.every((id) => prev[id] !== undefined);
  return same ? prev : next;
}

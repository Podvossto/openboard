// Pure rows for the Orchestrator HUD (unit-tested).
import type { ConsoleNode, Tile } from "../../lib/types";

export interface HudFlash {
  from: string;
  to: string;
  kind: string;
  at: number;
}
export interface HudRow {
  id: string;
  title: string;
  lead: boolean;
  workers: { id: string; title: string; sent: number; last: number }[];
  tiles: { id: string; title: string; kind: string; edits: number; last: number }[];
}

/**
 * One row per lead (its group-mates + consoles it messaged) and per console with linked
 * tiles. Counts come from recent flashes (session-local; reset on app restart).
 */
export function hudRows(consoles: ConsoleNode[], tiles: Tile[], contacted: Record<string, string[]>, flashes: HudFlash[]): HudRow[] {
  const byId = new Map(consoles.map((c) => [c.id, c]));
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const stats = (from: string, to: string, kind: string) => {
    const f = flashes.filter((x) => x.from === from && x.to === to && x.kind === kind);
    return { n: f.length, last: f.reduce((m, x) => Math.max(m, x.at), 0) };
  };
  const rows: HudRow[] = [];
  for (const c of consoles) {
    const workerIds = new Set<string>();
    if (c.lead) {
      for (const id of contacted[c.id] ?? []) workerIds.add(id);
      if (c.group) consoles.filter((x) => x.group === c.group && x.id !== c.id).forEach((x) => workerIds.add(x.id));
    }
    const linked = (c.links ?? []).map((id) => tileById.get(id)).filter((t): t is Tile => !!t);
    if (!c.lead && linked.length === 0) continue;
    rows.push({
      id: c.id,
      title: c.title,
      lead: !!c.lead,
      workers: [...workerIds]
        .filter((id) => byId.has(id))
        .map((id) => {
          const s = stats(c.id, id, "lead");
          return { id, title: byId.get(id)!.title, sent: s.n, last: s.last };
        }),
      tiles: linked.map((t) => {
        const s = stats(c.id, t.id, "tile");
        return { id: t.id, title: t.title, kind: t.kind, edits: s.n, last: s.last };
      }),
    });
  }
  // leads first, then by title
  return rows.sort((a, b) => Number(b.lead) - Number(a.lead) || a.title.localeCompare(b.title));
}

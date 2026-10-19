import type { Edge } from "@xyflow/react";
import type { ConsoleNode, Tile } from "../../lib/types";

export type FlowEdgeData = { kind: "lead" | "handoff" | "link"; active: boolean; color: string };
export type FlowEdge = Edge<FlowEdgeData, "flow">;

export interface Flash {
  from: string;
  to: string;
  kind: "lead" | "handoff" | "tile";
  at: number;
}

/**
 * Automatic edges:
 * - every lead → each worker in the same group (or, ungrouped lead → consoles it has messaged)
 * - recent handoffs (from → to) for a few seconds
 * `active` edges animate (a lead just sent work along them).
 */
/** Link edge colour per tile kind (matches the tile tints). */
export const LINK_COLOR: Record<string, string> = { kanban: "#5fd4a8", checklist: "#f2b45c", calendar: "#e57ad8" };

export function buildEdges(consoles: ConsoleNode[], flashes: Flash[], now: number, contacted: Record<string, string[]>, ttl = 6000, tiles: Tile[] = []): FlowEdge[] {
  const out = new Map<string, FlowEdge>();
  const live = flashes.filter((f) => now - f.at < ttl);
  const isActive = (a: string, b: string) => live.some((f) => f.from === a && f.to === b);
  const ids = new Set(consoles.map((c) => c.id));
  for (const lead of consoles.filter((c) => c.lead)) {
    const targets = new Set<string>(contacted[lead.id] ?? []);
    if (lead.group) consoles.filter((c) => c.group === lead.group && c.id !== lead.id).forEach((c) => targets.add(c.id));
    for (const t of targets) {
      if (!ids.has(t) || t === lead.id) continue;
      const id = `lead:${lead.id}->${t}`;
      out.set(id, {
        id,
        source: lead.id,
        target: t,
        type: "flow",
        data: { kind: "lead", active: isActive(lead.id, t), color: "#ffb547" },
        zIndex: 1,
      });
    }
  }
  for (const f of live.filter((x) => x.kind === "handoff")) {
    if (!ids.has(f.from) || !ids.has(f.to)) continue;
    const id = `handoff:${f.from}->${f.to}`;
    out.set(id, { id, source: f.from, target: f.to, type: "flow", data: { kind: "handoff", active: true, color: "#8ea2ff" }, zIndex: 1 });
  }
  // agent ↔ tile links (user-made); they light up while the agent edits the tile
  const tileKind = new Map(tiles.map((t) => [t.id, t.kind]));
  for (const c of consoles) {
    for (const tid of c.links ?? []) {
      const kind = tileKind.get(tid);
      if (!kind) continue;
      const id = `link:${c.id}->${tid}`;
      out.set(id, { id, source: c.id, target: tid, type: "flow", data: { kind: "link", active: isActive(c.id, tid), color: LINK_COLOR[kind] ?? "#8ea2ff" }, zIndex: 1 });
    }
  }
  return [...out.values()];
}

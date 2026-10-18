import type { Edge } from "@xyflow/react";
import type { ConsoleNode } from "../../lib/types";

export type FlowEdgeData = { kind: "lead" | "handoff"; active: boolean; color: string };
export type FlowEdge = Edge<FlowEdgeData, "flow">;

export interface Flash {
  from: string;
  to: string;
  kind: "lead" | "handoff";
  at: number;
}

/**
 * Automatic edges:
 * - every lead → each worker in the same group (or, ungrouped lead → consoles it has messaged)
 * - recent handoffs (from → to) for a few seconds
 * `active` edges animate (a lead just sent work along them).
 */
export function buildEdges(consoles: ConsoleNode[], flashes: Flash[], now: number, contacted: Record<string, string[]>, ttl = 6000): FlowEdge[] {
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
  return [...out.values()];
}

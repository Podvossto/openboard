import type { Node, NodeChange } from "@xyflow/react";
import type { ConsoleNode, Group } from "../../lib/types";

export type ConsoleFlowNode = Node<{ console: ConsoleNode }, "console">;
export type GroupFlowNode = Node<{ group: Group }, "group">;
export type AppNode = ConsoleFlowNode | GroupFlowNode;

/**
 * Merge persisted groups + consoles into React Flow nodes, keeping React Flow-owned fields
 * (measured size, selection, dragging) from the previous nodes.
 * Groups come first (React Flow requires parents before children).
 * Console positions are relative to their group (`parentId`) — same as the store.
 */
export function reconcile(consoles: ConsoleNode[], groups: Group[], prev: AppNode[]): AppNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  const groupIds = new Set(groups.map((g) => g.id));

  const groupNodes: GroupFlowNode[] = groups.map((g) => {
    const old = byId.get(g.id);
    const dragging = old?.dragging ?? false;
    return {
      ...(old as GroupFlowNode | undefined),
      id: g.id,
      type: "group",
      position: dragging && old ? old.position : { x: g.x, y: g.y },
      width: g.width,
      height: g.height,
      dragHandle: ".group-header",
      zIndex: 0,
      data: { group: g },
    };
  });

  const consoleNodes: ConsoleFlowNode[] = consoles.map((c) => {
    const old = byId.get(c.id);
    const dragging = old?.dragging ?? false;
    const parent = c.group && groupIds.has(c.group) ? c.group : undefined;
    const node: ConsoleFlowNode = {
      ...(old as ConsoleFlowNode | undefined),
      id: c.id,
      type: "console",
      // while dragging, React Flow's position is the truth
      position: dragging && old ? old.position : { x: c.x, y: c.y },
      width: c.width,
      height: c.height,
      dragHandle: ".console-header",
      data: { console: c },
    };
    if (parent) {
      node.parentId = parent;
      node.extent = "parent";
    } else {
      delete node.parentId;
      delete node.extent;
    }
    return node;
  });

  return [...groupNodes, ...consoleNodes];
}

export interface Persist {
  id: string;
  kind: "console" | "group";
  patch: Partial<{ x: number; y: number; width: number; height: number }>;
}

/** Which node changes must be written to the workspace (end of drag / resize only). */
export function persistableChanges(changes: NodeChange[], groupIds: ReadonlySet<string> = new Set()): Persist[] {
  const out: Persist[] = [];
  for (const ch of changes) {
    const kind = groupIds.has("id" in ch ? ch.id : "") ? "group" : "console";
    if (ch.type === "position" && ch.position && ch.dragging === false) {
      out.push({ id: ch.id, kind, patch: { x: Math.round(ch.position.x), y: Math.round(ch.position.y) } });
    } else if (ch.type === "dimensions" && ch.dimensions && ch.resizing === false) {
      out.push({
        id: ch.id,
        kind,
        patch: { width: Math.round(ch.dimensions.width), height: Math.round(ch.dimensions.height) },
      });
    }
  }
  return out;
}

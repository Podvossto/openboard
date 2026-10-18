import type { Node, NodeChange } from "@xyflow/react";
import type { ConsoleNode, Group, Tile } from "../../lib/types";

export type ConsoleFlowNode = Node<{ console: ConsoleNode }, "console">;
export type GroupFlowNode = Node<{ group: Group }, "group">;
export type TileFlowNode = Node<{ tile: Tile }, "tile">;
export type AppNode = ConsoleFlowNode | GroupFlowNode | TileFlowNode;

/**
 * Merge persisted groups + consoles into React Flow nodes, keeping React Flow-owned fields
 * (measured size, selection, dragging) from the previous nodes.
 * Groups come first (React Flow requires parents before children).
 * Console positions are relative to their group (`parentId`) — same as the store.
 */
export function reconcile(consoles: ConsoleNode[], groups: Group[], prev: AppNode[], tiles: Tile[] = []): AppNode[] {
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

  const tileNodes: TileFlowNode[] = tiles.map((t) => {
    const old = byId.get(t.id);
    const dragging = old?.dragging ?? false;
    const parent = t.group && groupIds.has(t.group) ? t.group : undefined;
    const node: TileFlowNode = {
      ...(old as TileFlowNode | undefined),
      id: t.id,
      type: "tile",
      position: dragging && old ? old.position : { x: t.x, y: t.y },
      width: t.width,
      height: t.height,
      dragHandle: ".tile-header",
      data: { tile: t },
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

  return [...groupNodes, ...consoleNodes, ...tileNodes];
}

export interface Persist {
  id: string;
  kind: "console" | "group" | "tile";
  patch: Partial<{ x: number; y: number; width: number; height: number }>;
}

/** Which node changes must be written to the workspace (end of drag / resize only). */
export function persistableChanges(
  changes: NodeChange[],
  groupIds: ReadonlySet<string> = new Set(),
  tileIds: ReadonlySet<string> = new Set(),
): Persist[] {
  const out: Persist[] = [];
  for (const ch of changes) {
    const id = "id" in ch ? ch.id : "";
    const kind = groupIds.has(id) ? "group" : tileIds.has(id) ? "tile" : "console";
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

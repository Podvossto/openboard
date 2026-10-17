import type { Node, NodeChange } from "@xyflow/react";
import type { ConsoleNode } from "../../lib/types";

export type ConsoleFlowNode = Node<{ console: ConsoleNode }, "console">;

/**
 * Merge persisted consoles into React Flow nodes, keeping React Flow-owned fields
 * (measured size, selection, dragging) from the previous nodes.
 */
export function reconcile(consoles: ConsoleNode[], prev: ConsoleFlowNode[]): ConsoleFlowNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return consoles.map((c) => {
    const old = byId.get(c.id);
    const dragging = old?.dragging ?? false;
    return {
      ...old,
      id: c.id,
      type: "console",
      // while dragging, React Flow's position is the truth
      position: dragging && old ? old.position : { x: c.x, y: c.y },
      width: c.width,
      height: c.height,
      dragHandle: ".console-header",
      data: { console: c },
    };
  });
}

export interface Persist {
  id: string;
  patch: Partial<Pick<ConsoleNode, "x" | "y" | "width" | "height">>;
}

/** Which node changes must be written to the workspace (end of drag / resize only). */
export function persistableChanges(changes: NodeChange[]): Persist[] {
  const out: Persist[] = [];
  for (const ch of changes) {
    if (ch.type === "position" && ch.position && ch.dragging === false) {
      out.push({ id: ch.id, patch: { x: Math.round(ch.position.x), y: Math.round(ch.position.y) } });
    } else if (ch.type === "dimensions" && ch.dimensions && ch.resizing === false) {
      out.push({
        id: ch.id,
        patch: { width: Math.round(ch.dimensions.width), height: Math.round(ch.dimensions.height) },
      });
    }
  }
  return out;
}

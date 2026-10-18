import type { ReactFlowInstance } from "@xyflow/react";
import { ipc } from "../../lib/ipc";
import type { TileData, TileKind } from "../../lib/types";
import { useBoard } from "../../store/board";
import { freeSpot, newTile, TILE_META, type Rect } from "./logic";
import { activeWorkspace } from "../../store/board";

/** Add a tile at the centre of the current view and select-pan to it. */
export async function addTile(
  kind: TileKind,
  rf: Pick<ReactFlowInstance, "screenToFlowPosition" | "setCenter" | "getZoom">,
  opts?: { data?: TileData[TileKind]; title?: string; at?: { x: number; y: number } },
) {
  const id = await ipc.newId();
  const m = TILE_META[kind];
  const el = document.querySelector(".react-flow");
  const r = el?.getBoundingClientRect();
  const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
  const ws = activeWorkspace(useBoard.getState().board);
  const abs = (rect: Rect & { group?: string }): Rect => {
    const g = rect.group ? ws.groups.find((x) => x.id === rect.group) : undefined;
    return g ? { x: rect.x + g.x, y: rect.y + g.y, width: rect.width, height: rect.height } : rect;
  };
  const taken: Rect[] = [...ws.groups, ...ws.consoles.filter((x) => !x.group), ...(ws.tiles ?? []).map(abs)];
  const centerPos = opts?.at ?? { x: Math.round(c.x - m.w / 2), y: Math.round(c.y - m.h / 2) };
  const p = opts?.at ? centerPos : freeSpot(centerPos, m.w, m.h, taken);
  const t = newTile(id, kind, p.x, p.y, opts?.title);
  if (opts?.data) t.data = opts.data;
  useBoard.getState().addTile(t);
  // bring it into view
  rf.setCenter(p.x + m.w / 2, p.y + m.h / 2, { zoom: rf.getZoom(), duration: 250 });
  return id;
}

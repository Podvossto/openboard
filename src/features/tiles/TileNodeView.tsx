import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useBoard } from "../../store/board";
import { motion } from "motion/react";
import { nodeVariants } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import type { Tile } from "../../lib/types";
import type { TileFlowNode } from "../board/nodes";
import { TILE_META } from "./logic";
import { TileIcon } from "./TileIcon";
import { NoteTile } from "./NoteTile";
import { ChecklistTile } from "./ChecklistTile";
import { KanbanTile } from "./KanbanTile";
import { WebTile } from "./WebTile";
import { GitTile } from "./GitTile";

const MIN: Record<Tile["kind"], [number, number]> = {
  note: [200, 140],
  checklist: [240, 180],
  kanban: [480, 260],
  web: [360, 260],
  git: [320, 300],
};

export const TileNodeView = memo(function TileNodeView({ data, selected }: NodeProps<TileFlowNode>) {
  const t = data.tile;
  const meta = TILE_META[t.kind];
  const [editing, setEditing] = useState(false);
  const [minW, minH] = MIN[t.kind];
  const patch = (p: Partial<Tile>) => useBoard.getState().patchTile(t.id, p);
  const setData = (d: Tile["data"]) => patch({ data: d });

  const leaving = useBoard((s) => !!s.leaving[t.id]);
  return (
    <motion.div
      variants={nodeVariants}
      initial="initial"
      animate={leaving ? "exit" : "animate"}
      className={`tile group/tile flex h-full w-full flex-col overflow-hidden rounded-[18px] border bg-surface shadow-[0_24px_60px_-24px_rgb(0_0_0/0.85)] transition-shadow ${
        selected ? "border-transparent" : "border-line"
      }`}
      style={
        selected
          ? { boxShadow: `0 0 0 1.5px ${meta.tint}, 0 0 28px -8px ${meta.tint}, 0 24px 60px -24px rgb(0 0 0 / 0.85)` }
          : undefined
      }
      data-kind={t.kind}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={minW}
        minHeight={minH}
        lineClassName="!border-transparent"
        handleClassName="!size-2.5 !rounded-full !border-0"
        handleStyle={{ background: meta.tint }}
      />
      <div className="tile-header flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-line px-3 active:cursor-grabbing">
        <TileIcon kind={t.kind} />
        {editing ? (
          <input
            className="nodrag h-7 min-w-0 flex-1 rounded-full border border-accent/70 bg-bg px-3 text-[13px] font-semibold text-ink outline-none"
            autoFocus
            defaultValue={t.title}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              patch({ title: e.target.value.trim() || meta.label });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink"
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {t.title}
          </span>
        )}
        <button
          className="nodrag grid size-7 place-items-center rounded-full text-ink-3 opacity-0 transition hover:bg-surface-3 hover:text-danger group-hover/tile:opacity-100 focus-visible:opacity-100"
          title={`Remove ${meta.label.toLowerCase()}`}
          aria-label={`Remove ${t.title}`}
          onClick={() => removeAnimated("tile", t.id)}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="nodrag nowheel nopan relative min-h-0 flex-1 cursor-auto">
        {t.kind === "note" && <NoteTile tile={t as Tile<"note">} setData={setData} />}
        {t.kind === "checklist" && <ChecklistTile tile={t as Tile<"checklist">} setData={setData} />}
        {t.kind === "kanban" && <KanbanTile tile={t as Tile<"kanban">} setData={setData} />}
        {t.kind === "web" && <WebTile tile={t as Tile<"web">} setData={setData} />}
        {t.kind === "git" && <GitTile tile={t as Tile<"git">} setData={setData} />}
      </div>
    </motion.div>
  );
});

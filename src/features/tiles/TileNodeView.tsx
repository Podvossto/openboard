import { memo, useRef, useState, useCallback, useEffect } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useBoard } from "../../store/board";
import { motion, AnimatePresence } from "motion/react";
import { nodeVariants, popVariants } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import type { Tile, TileData } from "../../lib/types";
import type { TileFlowNode } from "../board/nodes";
import { DEVICES, TILE_META, ZOOMS } from "./logic";
import { TileIcon } from "./TileIcon";
import { NoteTile } from "./NoteTile";
import { ChecklistTile } from "./ChecklistTile";
import { KanbanTile } from "./KanbanTile";
import { WebTile } from "./WebTile";
import { GitTile } from "./GitTile";
import { CodeTile } from "./CodeTile";
import { isLinkable } from "../links/tileOps";
import { CalendarTile } from "./CalendarTile";

const MIN: Record<Tile["kind"], [number, number]> = {
  note: [200, 140],
  checklist: [240, 180],
  kanban: [480, 260],
  web: [360, 260],
  git: [320, 300],
  code: [300, 200],
  calendar: [400, 340],
};

function TileMenu({
  tile,
  onRename,
  onRemove,
  setData,
}: {
  tile: Tile;
  onRename: () => void;
  onRemove: () => void;
  setData: (d: Tile["data"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const isWeb = tile.kind === "web";
  const webData = isWeb ? (tile.data as TileData["web"]) : null;

  return (
    <div className="relative nodrag" ref={ref}>
      <button
        className="grid size-7 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95"
        title="Tile options"
        aria-label="Tile options"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={popVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ transformOrigin: "top right" }}
            className="glass absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-xl p-1.5 shadow-2xl text-[12.5px]"
          >
            {isWeb && webData && (
              <>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">Device Preset</div>
                <div className="grid grid-cols-2 gap-1 mb-1.5">
                  {DEVICES.map((d) => (
                    <button
                      key={d.id}
                      className={`rounded-lg px-2 py-1 text-left text-[11px] truncate transition ${
                        (webData.preset ?? "responsive") === d.id ? "bg-accent/20 text-accent font-semibold" : "text-ink-2 hover:bg-surface-3"
                      }`}
                      onClick={() => {
                        if (d.id === "responsive") setData({ ...webData, preset: "responsive" });
                        else setData({ ...webData, preset: d.id, w: d.w!, h: d.h!, rotated: false });
                        setOpen(false);
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-3">Zoom</div>
                <div className="flex items-center gap-1 mb-1.5 px-1">
                  {ZOOMS.map((z) => (
                    <button
                      key={String(z)}
                      className={`flex-1 rounded-md py-0.5 text-center text-[10.5px] font-mono transition ${
                        (webData.zoom ?? "fit") === z ? "bg-accent/20 text-accent font-semibold" : "text-ink-3 hover:bg-surface-3"
                      }`}
                      onClick={() => {
                        setData({ ...webData, zoom: z });
                        setOpen(false);
                      }}
                    >
                      {z === "fit" ? "Fit" : `${Math.round(z * 100)}%`}
                    </button>
                  ))}
                </div>

                <div className="h-px bg-line my-1" />
              </>
            )}

            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-2 hover:bg-surface-3 hover:text-ink transition"
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Rename
            </button>

            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-danger hover:bg-danger/15 transition"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Remove tile
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const TileNodeView = memo(function TileNodeView({ data, selected }: NodeProps<TileFlowNode>) {
  const t = data.tile;
  const meta = TILE_META[t.kind];
  const [editing, setEditing] = useState(false);
  const [minW, minH] = MIN[t.kind];
  const patch = useCallback((p: Partial<Tile>) => useBoard.getState().patchTile(t.id, p), [t.id]);
  const setData = useCallback((d: Tile["data"]) => patch({ data: d }), [patch]);

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
      {isLinkable(t.kind) && <Handle id="link" type="target" position={Position.Left} className="tile-link-handle" isConnectableStart={false} />}
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

        {/* For web tiles: show compact preset badge */}
        {t.kind === "web" && (
          <span className="nodrag rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10.5px] font-mono text-ink-3">
            {(t.data as TileData["web"])?.preset ?? "responsive"}
          </span>
        )}

        {/* Sleek ... menu button replacing old x button */}
        <TileMenu
          tile={t}
          onRename={() => setEditing(true)}
          onRemove={() => removeAnimated("tile", t.id)}
          setData={setData}
        />
      </div>
      <div className="nodrag nowheel nopan relative min-h-0 flex-1 cursor-auto">
        {t.kind === "note" && <NoteTile tile={t as Tile<"note">} setData={setData} />}
        {t.kind === "checklist" && <ChecklistTile tile={t as Tile<"checklist">} setData={setData} />}
        {t.kind === "kanban" && <KanbanTile tile={t as Tile<"kanban">} setData={setData} />}
        {t.kind === "web" && <WebTile tile={t as Tile<"web">} setData={setData} />}
        {t.kind === "code" && <CodeTile tile={t as Tile<"code">} />}
        {t.kind === "git" && <GitTile tile={t as Tile<"git">} setData={setData} />}
        {t.kind === "calendar" && <CalendarTile tile={t as Tile<"calendar">} setData={setData} />}
      </div>
    </motion.div>
  );
});

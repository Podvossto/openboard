import { useCallback, useRef, useState } from "react";
import { ViewportPortal, useReactFlow, useStore } from "@xyflow/react";
import { activeWorkspace, useBoard } from "../../store/board";
import type { InkStroke } from "../../lib/types";
import { hits, simplify, toPath } from "./geometry";

const NO_INK: InkStroke[] = [];
let seq = 0;
const strokeId = () => `ink-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Strokes rendered in board space (pan/zoom with the board), under the nodes. */
export function InkStrokes() {
  const ink = useBoard((s) => activeWorkspace(s.board).ink ?? NO_INK);
  if (!ink.length) return null;
  return (
    <ViewportPortal>
      <svg className="ink-strokes pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
        {ink.map((s) => (
          <path key={s.id} d={toPath(s.points)} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </ViewportPortal>
  );
}

/** Full-screen capture surface while a drawing tool is active (above nodes). */
export function InkCapture() {
  const tool = useBoard((s) => s.ui.ink);
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [live, setLive] = useState<number[] | null>(null);
  const pts = useRef<number[]>([]);
  const erased = useRef<Set<string>>(new Set());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const toFlow = useCallback((e: React.PointerEvent) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), [rf]);

  const eraseAt = (x: number, y: number) => {
    const st = useBoard.getState();
    const ink = activeWorkspace(st.board).ink ?? [];
    const r = 10 / zoom;
    const ids = ink.filter((s) => !erased.current.has(s.id) && hits(s.points, s.width, x, y, r)).map((s) => s.id);
    if (ids.length) {
      ids.forEach((id) => erased.current.add(id));
      st.removeStrokes(ids);
    }
  };

  if (!tool) return null;
  const pen = tool.mode === "pen";
  return (
    <div
      className="ink-capture absolute inset-0 z-[5] touch-none"
      style={{ cursor: pen ? "crosshair" : "none" }}
      aria-label={pen ? "Drawing surface" : "Eraser surface"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toFlow(e);
        if (pen) {
          pts.current = [p.x, p.y];
          setLive(pts.current.slice());
        } else {
          erased.current = new Set();
          eraseAt(p.x, p.y);
        }
      }}
      onPointerMove={(e) => {
        setCursor({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
        if (!(e.buttons & 1)) return;
        const p = toFlow(e);
        if (pen) {
          pts.current.push(p.x, p.y);
          setLive(pts.current.slice());
        } else eraseAt(p.x, p.y);
      }}
      onPointerUp={() => {
        if (pen && pts.current.length >= 2) {
          useBoard.getState().addStroke({
            id: strokeId(),
            color: tool.color,
            // width is in screen px at the time of drawing → store in board units
            width: Math.round((tool.width / zoom) * 10) / 10,
            points: simplify(pts.current, 1.2 / zoom),
          });
        }
        pts.current = [];
        setLive(null);
      }}
      onPointerLeave={() => setCursor(null)}
    >
      {live && (
        <ViewportPortal>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
            <path d={toPath(live)} fill="none" stroke={tool.color} strokeWidth={tool.width / zoom} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ViewportPortal>
      )}
      {!pen && cursor && (
        <span
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink/80 bg-ink/10"
          style={{ left: cursor.x, top: cursor.y }}
        />
      )}
    </div>
  );
}

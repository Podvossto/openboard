import { memo } from "react";
import { BaseEdge, getBezierPath, Position, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";
import { motion, useReducedMotion } from "motion/react";
import type { FlowEdge as FlowEdgeType } from "./edges";

/**
 * Custom SVG edge: soft bezier with a glow; when active, a dashed "current" flows along it
 * plus a few travelling particles (motion offsetDistance along the path).
 */
export const FlowEdge = memo(function FlowEdge({ id, source, target, data }: EdgeProps<FlowEdgeType>) {
  const reduce = useReducedMotion();
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const { sx, sy, tx, ty, sp, tp } = floating(s, t);
  const [path] = getBezierPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: sp, targetPosition: tp, curvature: 0.3 });
  const color = data?.color ?? "#8ea2ff";
  const active = !!data?.active;
  return (
    <g className="flow-edge" data-kind={data?.kind} data-active={active || undefined}>
      <motion.path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeOpacity={0.08}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeOpacity: active ? 0.85 : 0.35, strokeWidth: 1.5, transition: "stroke-opacity 300ms" }} />
      {active && !reduce && (
        <>
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 10" strokeLinecap="round" className="flow-edge-dash" />
          {[0, 0.33, 0.66].map((delay) => (
            <motion.circle
              key={delay}
              r={3.5}
              fill={color}
              style={{ offsetPath: `path("${path}")`, filter: `drop-shadow(0 0 6px ${color})` }}
              initial={{ offsetDistance: "0%", opacity: 0 }}
              animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.4, delay: delay * 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </>
      )}
    </g>
  );
});

type Box = { x: number; y: number; w: number; h: number };
function box(n: InternalNode): Box {
  const p = n.internals.positionAbsolute;
  return { x: p.x, y: p.y, w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0 };
}

/** Floating edge: leave/enter through the sides that face each other (pure, exported for tests). */
export function floatingPoints(a: Box, b: Box) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  // horizontal when they are side by side (normalised by size), vertical when stacked
  if (Math.abs(dx) / (a.w + b.w) >= Math.abs(dy) / (a.h + b.h)) {
    const right = dx >= 0;
    return {
      sx: right ? a.x + a.w : a.x, sy: ac.y, sp: right ? Position.Right : Position.Left,
      tx: right ? b.x : b.x + b.w, ty: bc.y, tp: right ? Position.Left : Position.Right,
    };
  }
  const down = dy >= 0;
  return {
    sx: ac.x, sy: down ? a.y + a.h : a.y, sp: down ? Position.Bottom : Position.Top,
    tx: bc.x, ty: down ? b.y : b.y + b.h, tp: down ? Position.Top : Position.Bottom,
  };
}

function floating(s: InternalNode, t: InternalNode) {
  return floatingPoints(box(s), box(t));
}

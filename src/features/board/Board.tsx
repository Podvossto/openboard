import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { AnimatePresence } from "motion/react";
import { ConsoleNodeView } from "../console/ConsoleNodeView";
import { activeWorkspace, useBoard } from "../../store/board";
import { STATUS_COLOR } from "../console/statusStyle";
import { persistableChanges, reconcile, type AppNode } from "./nodes";
import { GroupNodeView } from "./GroupNodeView";
import { SectionNodeView } from "./SectionNodeView";
import { adoptedSection, membersOf, sectionAt } from "./sections";
import { ZoomControl } from "./ZoomControl";
import { FlowEdge } from "./FlowEdge";
import { buildEdges } from "./edges";
import { InkCapture, InkStrokes } from "../ink/InkLayer";
import { InkToolbar } from "../ink/InkToolbar";
import { TileNodeView } from "../tiles/TileNodeView";
import { RadialMenu } from "./RadialMenu";
import { SelectionBar } from "./SelectionBar";
import { OrchestratorHud } from "../links/OrchestratorHud";
import { linkConsole, linkValid, unlinkConsole } from "../links/linking";
import { SelectionMode } from "@xyflow/react";
import type { Section, Tile } from "../../lib/types";
import "./board.css";

const nodeTypes = { console: ConsoleNodeView, group: GroupNodeView, tile: TileNodeView, section: SectionNodeView };
const edgeTypes = { flow: FlowEdge };
const NO_TILES: Tile[] = [];
const NO_SECTIONS: Section[] = [];

/** Shows ONLY the active workspace; remounts per workspace so its saved viewport applies. */
export function Board() {
  const wsId = useBoard((s) => activeWorkspace(s.board).id);
  return <WorkspaceCanvas key={wsId} />;
}

function WorkspaceCanvas() {
  const rf = useReactFlow();
  const consoles = useBoard((s) => activeWorkspace(s.board).consoles);
  const groups = useBoard((s) => activeWorkspace(s.board).groups);
  const tiles = useBoard((s) => activeWorkspace(s.board).tiles ?? NO_TILES);
  const sections = useBoard((s) => activeWorkspace(s.board).sections ?? NO_SECTIONS);
  const runtime = useBoard((s) => s.runtime);
  const inking = useBoard((s) => !!s.ui.ink);
  const flashes = useBoard((s) => s.flashes);
  const contacted = useBoard((s) => s.contacted);

  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // re-evaluate edge activity when the newest flash expires
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!flashes.length) return;
    const last = Math.max(...flashes.map((f) => f.at));
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, last + 6050 - Date.now()));
    return () => clearTimeout(t);
  }, [flashes]);
  const edges = useMemo(() => buildEdges(consoles, flashes, now, contacted, 6000, tiles), [consoles, flashes, contacted, now, tiles]);
  // viewport is only read on mount (defaultViewport) — later changes come from the canvas itself
  const [initialViewport] = useState(() => activeWorkspace(useBoard.getState().board).viewport);
  const [nodes, setNodes] = useState<AppNode[]>(() => reconcile(consoles, groups, [], tiles, sections));

  // Store → nodes (add/remove/rename/persisted moves).
  useEffect(
    () => setNodes((prev) => reconcile(consoles, groups, prev, tiles, sections)),
    [consoles, groups, tiles, sections],
  );
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const tileIds = useMemo(() => new Set(tiles.map((t) => t.id)), [tiles]);

  const sectionIds = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);

  const [resizing, setResizing] = useState(false);
  /** a console → tile link drag is in progress (enables the tiles' drop zones) */
  const [linking, setLinking] = useState(false);
  const linkedOnDrop = useRef(false);
  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const rz = changes.some((c) => c.type === "dimensions" && c.resizing);
      setResizing((v) => (v === rz ? v : rz));
      const st = useBoard.getState();
      const ws = activeWorkspace(st.board);
      const secs = ws.sections ?? [];
      const prevNodes = nodesRef.current;
      // live: while a section is dragged its members follow by the same delta
      const follow = new Map<string, { dx: number; dy: number }>();
      for (const ch of changes) {
        if (ch.type !== "position" || !ch.position) continue;
        const sec = secs.find((x) => x.id === ch.id);
        const old = prevNodes.find((n) => n.id === ch.id);
        if (sec && old && ch.dragging === true) {
          const dx = ch.position.x - old.position.x;
          const dy = ch.position.y - old.position.y;
          for (const m of [...membersOf(ws.consoles, sec.id), ...membersOf(ws.groups, sec.id), ...membersOf(ws.tiles ?? [], sec.id)])
            follow.set(m.id, { dx, dy });
        }
        // highlight the section under a dragged loose item
        if (!sec && ch.dragging === true) {
          const item = ws.consoles.find((c) => c.id === ch.id) ?? ws.groups.find((g) => g.id === ch.id) ?? (ws.tiles ?? []).find((t) => t.id === ch.id);
          if (item && !("group" in item && item.group)) st.setSectionHot(sectionAt({ ...item, x: ch.position.x, y: ch.position.y }, secs) ?? null);
        }
      }
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds);
        if (!follow.size) return next;
        return next.map((n) => {
          const f = follow.get(n.id);
          return f ? { ...n, position: { x: n.position.x + f.dx, y: n.position.y + f.dy } } : n;
        });
      });
      for (const { id, kind, patch } of persistableChanges(changes, groupIds, tileIds, sectionIds)) {
        if (kind === "section") {
          const sec = secs.find((x) => x.id === id);
          if (patch.x !== undefined && patch.y !== undefined) st.moveSection(id, patch.x, patch.y);
          else if (sec) {
            // resize end: size + (top/left handles) the new origin; members don't move, membership is re-evaluated
            const node = prevNodes.find((n) => n.id === id);
            st.patchSection(id, { ...patch, ...(node ? { x: Math.round(node.position.x), y: Math.round(node.position.y) } : {}) });
            st.refreshSectionMembership();
          }
        } else if (kind === "group" || kind === "tile" || kind === "console") {
          const item = kind === "group" ? ws.groups.find((g) => g.id === id) : kind === "tile" ? (ws.tiles ?? []).find((t) => t.id === id) : ws.consoles.find((c) => c.id === id);
          const loose = item && !("group" in item && item.group);
          const full = { ...patch } as Record<string, unknown>;
          if (item && loose && patch.x !== undefined && patch.y !== undefined) {
            full.section = adoptedSection({ ...item, x: patch.x, y: patch.y }, secs, item.section);
          }
          if (kind === "group") st.patchGroup(id, full);
          else if (kind === "tile") st.patchTile(id, full);
          else st.patchConsole(id, full);
          st.setSectionHot(null);
        }
      }
    },
    [groupIds, tileIds, sectionIds],
  );

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
    useBoard.getState().setViewport(v);
  }, []);

  // cursor in canvas-local px: drives the dot-glow mask (the old full-screen overlay sat
  // UNDER the opaque dot background and used window coords, so it was never visible)
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden" onPointerMove={onPointerMove} onPointerLeave={() => setMousePos(null)}>

      <ReactFlow
        className={[resizing ? "is-resizing" : "", linking ? "is-linking" : ""].filter(Boolean).join(" ") || undefined}
        nodes={nodes}
        nodeTypes={nodeTypes}
        edges={edges}
        edgeTypes={edgeTypes}
        edgesFocusable={false}
        nodesConnectable={!inking}
        connectionRadius={40}
        connectionLineStyle={{ stroke: "#8ea2ff", strokeWidth: 2, strokeDasharray: "6 6" }}
        isValidConnection={(c) => linkValid(c.source, c.target)}
        onConnectStart={() => {
          linkedOnDrop.current = false;
          setLinking(true);
        }}
        onConnect={(c) => {
          linkedOnDrop.current = true;
          void linkConsole(c.source, c.target);
        }}
        onConnectEnd={(e, state) => {
          setLinking(false);
          if (linkedOnDrop.current) return;
          // fallback: dropped anywhere on a tile (not exactly on its handle)
          const pt = "changedTouches" in e ? e.changedTouches[0] : (e as MouseEvent);
          const el = pt ? document.elementFromPoint(pt.clientX, pt.clientY) : null;
          const target = el?.closest(".react-flow__node")?.getAttribute("data-id") ?? null;
          const source = state.fromNode?.id ?? null;
          if (linkValid(source, target)) void linkConsole(source, target);
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          if (edge.id.startsWith("link:")) void unlinkConsole(edge.source, edge.target);
        }}
        onNodesChange={onNodesChange}
        defaultViewport={initialViewport}
        onMoveEnd={onMoveEnd}
        onNodeClick={(_, n) => {
          setRadialMenu(null);
          useBoard.getState().setFocused(n.type === "console" ? n.id : null);
        }}
        onPaneClick={() => {
          setRadialMenu(null);
          useBoard.getState().setFocused(null);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const flow = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          setRadialMenu({ x: e.clientX, y: e.clientY, flowX: flow.x, flowY: flow.y });
        }}
        minZoom={0.15}
        maxZoom={2}
        panOnScroll
        panOnDrag={!inking}
        nodesDraggable={!inking}
        zoomOnScroll={false}
        zoomActivationKeyCode="Control"
        deleteKeyCode={null}
        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        selectionMode={SelectionMode.Partial}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#2b2c33" bgColor="#0a0b0d" />
        {/* hover glow: a brighter copy of the same dot grid, revealed in a soft circle around the cursor */}
        <Background
          id="dot-glow"
          className="board-dot-glow"
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.6}
          color="#8a8fa8"
          bgColor="transparent"
          style={{
            opacity: mousePos ? 1 : 0,
            maskImage: mousePos ? `radial-gradient(circle 200px at ${mousePos.x}px ${mousePos.y}px, #000 0%, rgba(0,0,0,0.45) 45%, transparent 100%)` : undefined,
            WebkitMaskImage: mousePos ? `radial-gradient(circle 200px at ${mousePos.x}px ${mousePos.y}px, #000 0%, rgba(0,0,0,0.45) 45%, transparent 100%)` : undefined,
          }}
        />
        <MiniMap
          className="board-minimap"
          position="bottom-left"
          pannable
          zoomable
          maskColor="rgba(10, 11, 13, 0.72)"
          nodeColor={(n) => {
            if (n.type === "section") return `${(n.data as { section: Section }).section.color}44`;
            if (n.type === "group") return "rgba(124, 156, 255, 0.18)";
            if (n.type === "tile") return "rgba(242, 212, 90, 0.45)";
            const r = runtime[n.id];
            return STATUS_COLOR[r?.running ? r.status : "exited"];
          }}
        />
        <InkStrokes />
        <InkCapture />
        <InkToolbar />
        <ZoomControl />
      </ReactFlow>

      <OrchestratorHud />
      <SelectionBar onGroup={() => window.dispatchEvent(new CustomEvent("board:group-selected"))} />

      <AnimatePresence>
        {radialMenu && (
          <RadialMenu
            x={radialMenu.x}
            y={radialMenu.y}
            flowX={radialMenu.flowX}
            flowY={radialMenu.flowY}
            onClose={() => setRadialMenu(null)}
            onOpenAddConsoleDialog={(p) => useBoard.getState().setUi({ addConsole: { pos: p } })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

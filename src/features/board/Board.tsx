import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { ConsoleNodeView } from "../console/ConsoleNodeView";
import { activeWorkspace, useBoard } from "../../store/board";
import { STATUS_COLOR } from "../console/statusStyle";
import { persistableChanges, reconcile, type AppNode } from "./nodes";
import { GroupNodeView } from "./GroupNodeView";
import { ZoomControl } from "./ZoomControl";
import { FlowEdge } from "./FlowEdge";
import { buildEdges } from "./edges";
import { InkCapture, InkStrokes } from "../ink/InkLayer";
import { InkToolbar } from "../ink/InkToolbar";
import { TileNodeView } from "../tiles/TileNodeView";
import type { Tile } from "../../lib/types";
import "./board.css";

const nodeTypes = { console: ConsoleNodeView, group: GroupNodeView, tile: TileNodeView };
const edgeTypes = { flow: FlowEdge };
const NO_TILES: Tile[] = [];

/** Shows ONLY the active workspace; remounts per workspace so its saved viewport applies. */
export function Board() {
  const wsId = useBoard((s) => activeWorkspace(s.board).id);
  return <WorkspaceCanvas key={wsId} />;
}

function WorkspaceCanvas() {
  const consoles = useBoard((s) => activeWorkspace(s.board).consoles);
  const groups = useBoard((s) => activeWorkspace(s.board).groups);
  const tiles = useBoard((s) => activeWorkspace(s.board).tiles ?? NO_TILES);
  const runtime = useBoard((s) => s.runtime);
  const inking = useBoard((s) => !!s.ui.ink);
  const flashes = useBoard((s) => s.flashes);
  const contacted = useBoard((s) => s.contacted);
  // re-evaluate edge activity when the newest flash expires
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!flashes.length) return;
    const last = Math.max(...flashes.map((f) => f.at));
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, last + 6050 - Date.now()));
    return () => clearTimeout(t);
  }, [flashes]);
  const edges = useMemo(() => buildEdges(consoles, flashes, now, contacted), [consoles, flashes, contacted, now]);
  // viewport is only read on mount (defaultViewport) — later changes come from the canvas itself
  const [initialViewport] = useState(() => activeWorkspace(useBoard.getState().board).viewport);
  const [nodes, setNodes] = useState<AppNode[]>(() => reconcile(consoles, groups, [], tiles));

  // Store → nodes (add/remove/rename/persisted moves).
  useEffect(() => setNodes((prev) => reconcile(consoles, groups, prev, tiles)), [consoles, groups, tiles]);

  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const tileIds = useMemo(() => new Set(tiles.map((t) => t.id)), [tiles]);

  const [resizing, setResizing] = useState(false);
  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const rz = changes.some((c) => c.type === "dimensions" && c.resizing);
      setResizing((v) => (v === rz ? v : rz));
      setNodes((nds) => applyNodeChanges(changes, nds));
      const st = useBoard.getState();
      for (const { id, kind, patch } of persistableChanges(changes, groupIds, tileIds)) {
        if (kind === "group") st.patchGroup(id, patch);
        else if (kind === "tile") st.patchTile(id, patch);
        else st.patchConsole(id, patch);
      }
    },
    [groupIds, tileIds],
  );

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
    useBoard.getState().setViewport(v);
  }, []);

  return (
    <ReactFlow
      className={resizing ? "is-resizing" : undefined}
      nodes={nodes}
      nodeTypes={nodeTypes}
      edges={edges}
      edgeTypes={edgeTypes}
      edgesFocusable={false}
      nodesConnectable={false}
      onNodesChange={onNodesChange}
      defaultViewport={initialViewport}
      onMoveEnd={onMoveEnd}
      onNodeClick={(_, n) => useBoard.getState().setFocused(n.type === "console" ? n.id : null)}
      onPaneClick={() => useBoard.getState().setFocused(null)}
      minZoom={0.15}
      maxZoom={2}
      panOnScroll
      panOnDrag={!inking}
      nodesDraggable={!inking}
      zoomOnScroll={false}
      zoomActivationKeyCode="Control"
      deleteKeyCode={null}
      selectionOnDrag={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#2b2c33" bgColor="#0a0b0d" />
      <MiniMap
        className="board-minimap"
        position="bottom-left"
        pannable
        zoomable
        maskColor="rgba(10, 11, 13, 0.72)"
        nodeColor={(n) => {
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
  );
}

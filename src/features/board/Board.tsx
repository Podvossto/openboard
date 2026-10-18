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
import "./board.css";

const nodeTypes = { console: ConsoleNodeView, group: GroupNodeView };

/** Shows ONLY the active workspace; remounts per workspace so its saved viewport applies. */
export function Board() {
  const wsId = useBoard((s) => activeWorkspace(s.board).id);
  return <WorkspaceCanvas key={wsId} />;
}

function WorkspaceCanvas() {
  const consoles = useBoard((s) => activeWorkspace(s.board).consoles);
  const groups = useBoard((s) => activeWorkspace(s.board).groups);
  const runtime = useBoard((s) => s.runtime);
  // viewport is only read on mount (defaultViewport) — later changes come from the canvas itself
  const [initialViewport] = useState(() => activeWorkspace(useBoard.getState().board).viewport);
  const [nodes, setNodes] = useState<AppNode[]>(() => reconcile(consoles, groups, []));

  // Store → nodes (add/remove/rename/persisted moves).
  useEffect(() => setNodes((prev) => reconcile(consoles, groups, prev)), [consoles, groups]);

  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);

  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      const st = useBoard.getState();
      for (const { id, kind, patch } of persistableChanges(changes, groupIds)) {
        if (kind === "group") st.patchGroup(id, patch);
        else st.patchConsole(id, patch);
      }
    },
    [groupIds],
  );

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
    useBoard.getState().setViewport(v);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      defaultViewport={initialViewport}
      onMoveEnd={onMoveEnd}
      onNodeClick={(_, n) => useBoard.getState().setFocused(n.type === "console" ? n.id : null)}
      onPaneClick={() => useBoard.getState().setFocused(null)}
      minZoom={0.15}
      maxZoom={2}
      panOnScroll
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
          const r = runtime[n.id];
          return STATUS_COLOR[r?.running ? r.status : "exited"];
        }}
      />
      <ZoomControl />
    </ReactFlow>
  );
}

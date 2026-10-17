import { useCallback, useEffect, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { ConsoleNodeView } from "../console/ConsoleNodeView";
import { useBoard } from "../../store/board";
import { STATUS_COLOR } from "../console/statusStyle";
import { persistableChanges, reconcile, type ConsoleFlowNode } from "./nodes";

const nodeTypes = { console: ConsoleNodeView };

export function Board() {
  const consoles = useBoard((s) => s.workspace.consoles);
  const viewport = useBoard((s) => s.workspace.viewport);
  const runtime = useBoard((s) => s.runtime);
  const [nodes, setNodes] = useState<ConsoleFlowNode[]>(() => reconcile(consoles, []));

  // Store → nodes (add/remove/rename/persisted moves).
  useEffect(() => setNodes((prev) => reconcile(consoles, prev)), [consoles]);

  const onNodesChange = useCallback((changes: NodeChange<ConsoleFlowNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    const { patchConsole } = useBoard.getState();
    for (const { id, patch } of persistableChanges(changes)) patchConsole(id, patch);
  }, []);

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
    useBoard.getState().setViewport(v);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      defaultViewport={viewport}
      onMoveEnd={onMoveEnd}
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
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => STATUS_COLOR[runtime[n.id]?.running ? (runtime[n.id]?.status ?? "exited") : "exited"]}
      />
    </ReactFlow>
  );
}

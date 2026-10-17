import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { ConsoleNodeView, type ConsoleFlowNode } from "../console/ConsoleNodeView";
import { useBoard } from "../../store/board";
import { STATUS_COLOR } from "../console/statusStyle";

const nodeTypes = { console: ConsoleNodeView };

export function Board() {
  const consoles = useBoard((s) => s.workspace.consoles);
  const viewport = useBoard((s) => s.workspace.viewport);
  const runtime = useBoard((s) => s.runtime);
  const [selected, setSelected] = useState<string | null>(null);

  const nodes: ConsoleFlowNode[] = useMemo(
    () =>
      consoles.map((c) => ({
        id: c.id,
        type: "console",
        position: { x: c.x, y: c.y },
        width: c.width,
        height: c.height,
        dragHandle: ".console-header",
        selected: c.id === selected,
        data: { console: c },
      })),
    [consoles, selected],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    const { patchConsole } = useBoard.getState();
    for (const ch of changes) {
      if (ch.type === "select") {
        setSelected((cur) => (ch.selected ? ch.id : cur === ch.id ? null : cur));
      } else if (ch.type === "position" && ch.position && !ch.dragging) {
        patchConsole(ch.id, { x: Math.round(ch.position.x), y: Math.round(ch.position.y) });
      } else if (ch.type === "position" && ch.position) {
        // live drag: update without waiting for drop so the node follows the cursor
        patchConsole(ch.id, { x: ch.position.x, y: ch.position.y });
      } else if (ch.type === "dimensions" && ch.dimensions && ch.resizing !== undefined) {
        patchConsole(ch.id, {
          width: Math.round(ch.dimensions.width),
          height: Math.round(ch.dimensions.height),
        });
      }
    }
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
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => STATUS_COLOR[runtime[n.id]?.status ?? "exited"]}
      />
    </ReactFlow>
  );
}

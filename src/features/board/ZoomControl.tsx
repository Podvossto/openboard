import { Panel, useReactFlow, useStore } from "@xyflow/react";

const selectZoom = (s: { transform: [number, number, number] }) => s.transform[2];

export function ZoomControl() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore(selectZoom);
  return (
    <Panel position="bottom-right" className="zoom-control">
      <button className="btn icon ghost" title="Zoom out" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
        −
      </button>
      <button className="btn ghost zoom-pct" title="Reset to 100%" onClick={() => zoomTo(1, { duration: 200 })}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="btn icon ghost" title="Zoom in" aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
        +
      </button>
      <span className="zoom-sep" />
      <button
        className="btn icon ghost"
        title="Fit all to view"
        aria-label="Fit view"
        onClick={() => fitView({ padding: 0.1, duration: 300, maxZoom: 1 })}
      >
        ⤢
      </button>
    </Panel>
  );
}

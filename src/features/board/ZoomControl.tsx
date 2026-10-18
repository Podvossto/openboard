import { Panel, useReactFlow, useStore } from "@xyflow/react";

const selectZoom = (s: { transform: [number, number, number] }) => s.transform[2];

const btn =
  "grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95";

export function ZoomControl() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore(selectZoom);
  return (
    <Panel position="bottom-right" className="zoom-control glass !mb-4 !mr-4 flex items-center gap-0.5 rounded-full p-1">
      <button className={btn} title="Zoom out" aria-label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </button>
      <button
        className="h-8 min-w-14 rounded-full px-2 text-[12px] font-semibold tabular-nums text-ink transition hover:bg-surface-3"
        title="Reset to 100%"
        onClick={() => zoomTo(1, { duration: 200 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} title="Zoom in" aria-label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <button className={btn} title="Fit all to view" aria-label="Fit view" onClick={() => fitView({ padding: 0.1, duration: 300, maxZoom: 1 })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
      </button>
    </Panel>
  );
}

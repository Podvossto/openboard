import { useLayoutEffect, useRef, useState } from "react";
import type { Tile, TileData } from "../../lib/types";
import { DEVICES, fitScale, matchPreset, normalizeUrl, ZOOMS } from "./logic";

const select =
  "h-7 min-w-0 rounded-full border border-line bg-bg/70 px-2 text-[11.5px] text-ink-2 outline-none transition focus:border-accent/70 disabled:opacity-40";
const num =
  "h-7 w-[52px] rounded-full border border-line bg-bg/70 px-2 text-center font-mono text-[11.5px] text-ink-2 outline-none transition focus:border-accent/70 disabled:opacity-40";
const iconBtn = "grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

/** Live web preview (meant for localhost dev servers) with device-size presets. */
export function WebTile({ tile, setData }: { tile: Tile<"web">; setData: (d: TileData["web"]) => void }) {
  const d = tile.data;
  const [draft, setDraft] = useState(d.url ?? "");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState(false);
  const url = normalizeUrl(d.url ?? "");

  const presetId = d.preset ?? "responsive";
  const w = d.w ?? 393;
  const h = d.h ?? 852;
  const zoom = d.zoom ?? "fit";
  const responsive = presetId === "responsive";
  const patch = (p: Partial<TileData["web"]>) => setData({ ...d, ...p });

  const go = () => {
    const u = normalizeUrl(draft);
    setErr(!u);
    if (u) {
      setDraft(u);
      patch({ url: u });
      setNonce((n) => n + 1);
    }
  };

  const setDim = (which: "w" | "h") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(64, Math.min(8192, Math.round(Number(e.target.value) || 0)));
    if (!v) return;
    const nw = which === "w" ? v : w;
    const nh = which === "h" ? v : h;
    patch({ w: nw, h: nh, preset: matchPreset(presetId, nw, nh) });
  };

  // viewport of the stage, so "Fit" can scale the device to it
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = zoom === "fit" ? fitScale(stageSize.w - 24, stageSize.h - 24, w, h) : zoom;
  const pct = `${Math.round((zoom === "fit" ? s : zoom) * 100)}%`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          className={iconBtn}
          title="Reload"
          aria-label="Reload"
          onClick={() => setNonce((n) => n + 1)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
        <input
          aria-label="URL"
          className={`h-8 min-w-0 flex-1 rounded-full border bg-bg/70 px-3 font-mono text-[12px] text-ink outline-none transition focus:border-accent/70 ${
            err ? "border-danger" : "border-line"
          }`}
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        {url && (
          <a
            className={iconBtn}
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in browser"
            aria-label="Open in browser"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
            </svg>
          </a>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <select
          aria-label="Device"
          className={`${select} flex-1`}
          value={presetId}
          onChange={(e) => {
            const p = DEVICES.find((x) => x.id === e.target.value);
            if (!p) return;
            if (p.id === "responsive") patch({ preset: "responsive" });
            else patch({ preset: p.id, w: p.w!, h: p.h!, rotated: false });
          }}
        >
          {DEVICES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <input aria-label="Width" className={num} type="number" min={64} max={8192} step={1} value={w} disabled={responsive} onChange={setDim("w")} />
        <span className="text-[11px] text-ink-3">×</span>
        <input aria-label="Height" className={num} type="number" min={64} max={8192} step={1} value={h} disabled={responsive} onChange={setDim("h")} />
        <button
          className={iconBtn}
          title="Rotate (swap W×H)"
          aria-label="Rotate device"
          disabled={responsive}
          onClick={() => patch({ w: h, h: w, rotated: !d.rotated })}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3L4 7l4 4M4 7h13" />
            <path d="M16 21l4-4-4-4M20 17H7" />
          </svg>
        </button>
        <select
          aria-label="Zoom"
          className={select}
          value={String(zoom)}
          disabled={responsive}
          onChange={(e) => patch({ zoom: e.target.value === "fit" ? "fit" : Number(e.target.value) })}
        >
          {ZOOMS.map((z) => (
            <option key={String(z)} value={String(z)}>
              {z === "fit" ? "Fit" : `${Math.round(z * 100)}%`}
            </option>
          ))}
        </select>
      </div>
      {url ? responsive ? (
        <iframe
          key={nonce}
          title={tile.title}
          src={url}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <div ref={stage} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-surface-2/40 p-3">
          {/* outer box is the scaled size; inner keeps exact device px and is transform-scaled */}
          <div className="relative" style={{ width: Math.round(w * s), height: Math.round(h * s) }}>
            <div
              data-device-frame
              className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[22px] border-[3px] border-line-strong bg-white shadow-[0_18px_48px_-18px_rgb(0_0_0/0.8)]"
              style={{ width: w, height: h, transform: `scale(${s})` }}
            >
              <iframe
                key={nonce}
                title={tile.title}
                src={url}
                width={w}
                height={h}
                style={{ width: w, height: h }}
                className="block border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
            </div>
          </div>
          <span
            aria-label="Device size"
            className="pointer-events-none absolute bottom-1.5 right-2 rounded-full bg-surface-2/90 px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-ink-3"
          >
            {w} × {h} · {pct}
          </span>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-[13px] text-ink-3">Enter a URL, e.g. localhost:5173</div>
      )}
    </div>
  );
}

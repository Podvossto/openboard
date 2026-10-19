import { useLayoutEffect, useRef, useState } from "react";
import type { Tile, TileData } from "../../lib/types";
import { fitScale, normalizeUrl } from "./logic";
import { nativeBrowserAvailable, browserIpc } from "./browser";
import { NativeBrowser } from "./NativeBrowser";

const iconBtn = "grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

/** Live web preview (meant for localhost dev servers or web browsing) with minimal sleek header. */
export function WebTile({ tile, setData }: { tile: Tile<"web">; setData: (d: TileData["web"]) => void }) {
  const d = tile.data;
  const [draft, setDraft] = useState(d.url ?? "");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState(false);
  const url = normalizeUrl(d.url ?? "");
  // real WebView2 browser inside the desktop app (no X-Frame-Options limits); iframe elsewhere
  const [native] = useState(nativeBrowserAvailable);
  const [loading, setLoading] = useState(false);
  const [navErr, setNavErr] = useState<string | null>(null);
  const onNav = (u: string, isLoading: boolean) => {
    setLoading(isLoading);
    // keep the address bar in sync with in-page navigation (don't persist every hop)
    if (document.activeElement?.getAttribute("aria-label") !== "URL") setDraft(u);
  };

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
  }, [responsive, url]);

  const s = zoom === "fit" ? fitScale(stageSize.w - 24, stageSize.h - 24, w, h) : zoom;
  const pct = `${Math.round((zoom === "fit" ? s : zoom) * 100)}%`;

  return (
    <div className="flex h-full flex-col">
      {/* Sleek minimal URL row */}
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        {native && url && (
          <>
            <button className={iconBtn} title="Back" aria-label="Back" onClick={() => void browserIpc.action(tile.id, "back")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button className={iconBtn} title="Forward" aria-label="Forward" onClick={() => void browserIpc.action(tile.id, "forward")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </>
        )}
        <button
          className={iconBtn}
          title={loading ? "Stop" : "Reload"}
          aria-label={loading ? "Stop" : "Reload"}
          onClick={() => (native && loading ? void browserIpc.action(tile.id, "stop") : setNonce((n) => n + 1))}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
        <input
          aria-label="URL"
          className={`h-7 min-w-0 flex-1 rounded-full border bg-bg/70 px-3 font-mono text-[12px] text-ink outline-none transition focus:border-accent/70 ${
            err ? "border-danger" : "border-line"
          }`}
          value={draft}
          placeholder="http://localhost:5173 or https://..."
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
        {!responsive && (
          <button
            className={iconBtn}
            title="Rotate (swap W×H)"
            aria-label="Rotate device"
            onClick={() => patch({ w: h, h: w, rotated: !d.rotated })}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3L4 7l4 4M4 7h13" />
              <path d="M16 21l4-4-4-4M20 17H7" />
            </svg>
          </button>
        )}
        {url && (
          <a
            className={iconBtn}
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in external browser"
            aria-label="Open in external browser"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
            </svg>
          </a>
        )}
      </div>

      {navErr && (
        <div role="alert" className="border-b border-danger/40 bg-danger/10 px-3 py-1 text-[11.5px] text-danger">
          {navErr}
        </div>
      )}
      {url && native && responsive ? (
        <div className="min-h-0 flex-1">
          <NativeBrowser tileId={tile.id} url={url} nonce={nonce} onNav={onNav} onError={setNavErr} />
        </div>
      ) : url && native ? (
        <div ref={stage} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-surface-2/40 p-3">
          <div
            data-device-frame
            className="overflow-hidden rounded-[22px] border-[3px] border-line-strong bg-white shadow-[0_18px_48px_-18px_rgb(0_0_0/0.8)]"
            style={{ width: Math.round(w * s) + 6, height: Math.round(h * s) + 6 }}
          >
            <NativeBrowser tileId={tile.id} url={url} nonce={nonce} scale={s} onNav={onNav} onError={setNavErr} />
          </div>
          <span
            aria-label="Device size"
            className="pointer-events-none absolute bottom-1.5 right-2 rounded-full bg-surface-2/90 px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-ink-3"
          >
            {w} × {h} · {pct}
          </span>
        </div>
      ) : url ? responsive ? (
        <iframe
          key={nonce}
          title={tile.title}
          src={url}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <div ref={stage} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-surface-2/40 p-3">
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

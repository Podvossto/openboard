import { useState } from "react";
import type { Tile, TileData } from "../../lib/types";
import { normalizeUrl } from "./logic";

/** Live web preview (meant for localhost dev servers). */
export function WebTile({ tile, setData }: { tile: Tile<"web">; setData: (d: TileData["web"]) => void }) {
  const [draft, setDraft] = useState(tile.data.url ?? "");
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState(false);
  const url = normalizeUrl(tile.data.url ?? "");
  const go = () => {
    const u = normalizeUrl(draft);
    setErr(!u);
    if (u) {
      setDraft(u);
      setData({ url: u });
      setNonce((n) => n + 1);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <button
          className="grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink"
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
            className="grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink"
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
      {url ? (
        <iframe
          key={nonce}
          title={tile.title}
          src={url}
          className="min-h-0 flex-1 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      ) : (
        <div className="grid flex-1 place-items-center text-[13px] text-ink-3">Enter a URL, e.g. localhost:5173</div>
      )}
    </div>
  );
}

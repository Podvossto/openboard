import { useEffect, useRef, useState } from "react";
import type { Tile, TileData } from "../../lib/types";

/** Sticky note: plain text, saved 400ms after typing stops. */
export function NoteTile({ tile, setData }: { tile: Tile<"note">; setData: (d: TileData["note"]) => void }) {
  const [text, setText] = useState(tile.data.text ?? "");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(tile.data);
  latest.current = tile.data;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <textarea
      aria-label="Note text"
      className="h-full w-full resize-none bg-[color-mix(in_srgb,#f2d45a_5%,transparent)] px-4 py-3 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
      placeholder="Write a note…"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setData({ ...latest.current, text: v }), 400);
      }}
      onBlur={() => {
        window.clearTimeout(timer.current);
        if (text !== tile.data.text) setData({ ...tile.data, text });
      }}
    />
  );
}

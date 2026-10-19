import type { Tile } from "../../lib/types";

/** Picture dropped onto the board (stored as a data URL in the tile). */
export function ImageTile({ tile }: { tile: Tile<"image"> }) {
  const { src, name } = tile.data;
  if (!src) return <div className="grid h-full place-items-center text-[12px] text-ink-3">No image</div>;
  return (
    <div className="grid h-full place-items-center overflow-hidden bg-black/30 p-1">
      <img src={src} alt={name ?? tile.title} draggable={false} className="max-h-full max-w-full select-none rounded-lg object-contain" />
    </div>
  );
}

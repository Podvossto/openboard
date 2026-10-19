import type { TileKind } from "../../lib/types";
import { TILE_META } from "./logic";

const PATHS: Record<TileKind, string> = {
  note: "M6 4h9l4 4v12H6zM15 4v4h4M9 12h7M9 16h5",
  checklist: "M5 7l2 2 3-3M5 15l2 2 3-3M13 8h6M13 16h6",
  kanban: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z",
  web: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  git: "M7 5v10M7 15a2 2 0 100 4 2 2 0 000-4zM7 5a2 2 0 100-.01M17 9a2 2 0 100-4 2 2 0 000 4zM17 9c0 4-4 4-10 6",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4M13.5 5l-3 14",
  calendar: "M5 7h14v13H5zM5 11h14M9 4v4M15 4v4M9 15h3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5a1.5 1.5 0 100-.01",
};

export function TileIcon({ kind, size = 15 }: { kind: TileKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d={PATHS[kind]} stroke={TILE_META[kind].tint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

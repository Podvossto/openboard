// Serves agents' tile tool calls: backend emits `tile://op`, we apply it to the store (the
// board updates live and autosaves like a manual edit), then answer with tile_op_result.
import { useEffect } from "react";
import { events, ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import { applyTileOp } from "./tileOps";

const shortId = () => Math.random().toString(36).slice(2, 8);
/** op ids already applied — a doubled listener (StrictMode / HMR) must never apply twice */
const seen = new Set<string>();

export function useTileOps() {
  useEffect(() => {
    const off = events.onTileOp(({ opId, from, tile, tool, args }) => {
      if (seen.has(opId)) return;
      seen.add(opId);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      const st = useBoard.getState();
      const ws = st.board.workspaces.find((w) => (w.tiles ?? []).some((t) => t.id === tile));
      const t = ws?.tiles?.find((x) => x.id === tile);
      const owner = st.board.workspaces.flatMap((w) => w.consoles).find((c) => c.id === from);
      if (!t || !owner?.links?.includes(tile)) {
        void ipc.tileOpResult(opId, null, "that tile is no longer linked to you").catch(() => undefined);
        return;
      }
      const r = applyTileOp(t, tool, args ?? {}, shortId, { name: owner.title, at: Date.now() });
      if (!r.ok) {
        void ipc.tileOpResult(opId, null, r.error).catch(() => undefined);
        return;
      }
      if (!tool.endsWith("_list")) {
        st.patchTile(tile, { data: r.data });
        st.flash(from, tile, "tile");
        st.pulse(tile);
      }
      void ipc.tileOpResult(opId, r.text, null).catch(() => undefined);
    });
    return () => void off.then((f) => f());
  }, []);
}

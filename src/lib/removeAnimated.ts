// React Flow unmounts a node the moment it leaves `nodes`, so AnimatePresence can't run
// an exit. Instead: mark the id as "leaving" (the node plays its exit), then remove it.
import { useBoard } from "../store/board";
import { EXIT_MS } from "./motion";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function removeAnimated(kind: "console" | "tile" | "group" | "section", id: string) {
  const st = useBoard.getState();
  const finish = () => {
    const s = useBoard.getState();
    s.setLeaving(id, false);
    if (kind === "console") s.removeConsole(id);
    else if (kind === "tile") s.removeTile(id);
    else if (kind === "group") s.removeGroup(id);
    else s.removeSection(id);
  };
  if (reduced()) return finish();
  st.setLeaving(id, true);
  setTimeout(finish, EXIT_MS);
}

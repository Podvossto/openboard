import { useEffect, useMemo } from "react";
import { ipc } from "../../lib/ipc";
import { debounce } from "../../lib/debounce";
import { useBoard } from "../../store/board";

/** Persist on every structural change (debounced) and on window close. */
export function useAutosave() {
  const revision = useBoard((s) => s.revision);
  const save = useMemo(
    () =>
      debounce(() => {
        ipc.saveWorkspace(useBoard.getState().workspace).catch((e) => {
          console.error("save failed", e);
        });
      }, 400),
    [],
  );

  useEffect(() => {
    if (revision > 0) save();
  }, [revision, save]);

  useEffect(() => {
    const flush = () => save.flush();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [save]);
}

import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Board } from "../features/board/Board";
import { Toolbar } from "../features/board/Toolbar";
import { useBoardRuntime } from "../features/console/useBoardRuntime";
import { useAutosave } from "../features/board/useAutosave";
import { ipc } from "../lib/ipc";
import { useBoard } from "../store/board";

export function App() {
  const loaded = useBoard((s) => s.loaded);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .loadWorkspace()
      .then(({ workspace, recoveredFromBackup }) => {
        useBoard.getState().hydrate(workspace);
        if (recoveredFromBackup)
          setNotice(`Workspace file was damaged — restored from backup #${recoveredFromBackup}.`);
      })
      .catch((e) => {
        setNotice(`Could not load workspace: ${String(e)}`);
        useBoard.getState().hydrate(useBoard.getState().workspace);
      });
  }, []);

  useBoardRuntime();
  useAutosave();

  if (!loaded) return <div className="splash">Loading…</div>;
  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        <Board />
      </div>
    </ReactFlowProvider>
  );
}

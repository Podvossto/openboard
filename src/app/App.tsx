// App shell. CONTRACT: the mount points below are fixed; each feature owns its component.
import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Board } from "../features/board/Board";
import { TopBar } from "../features/shell/TopBar";
import { Rail } from "../features/shell/Rail";
import { Dock } from "../features/dock/Dock";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { MemoryPanel } from "../features/dock/MemoryPanel";
import { useBoardRuntime } from "../features/console/useBoardRuntime";
import { useAutosave } from "../features/board/useAutosave";
import { ipc } from "../lib/ipc";
import { useBoard } from "../store/board";

export function App() {
  const loaded = useBoard((s) => s.loaded);
  const ui = useBoard((s) => s.ui);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .loadSettings()
      .then(({ settings, resolvedCwd }) => useBoard.getState().setSettings(settings, resolvedCwd))
      .catch(() => undefined);
    ipc
      .loadBoard()
      .then(({ board, recoveredFromBackup }) => {
        useBoard.getState().hydrate(board);
        if (recoveredFromBackup)
          setNotice(`Workspace file was damaged — restored from backup #${recoveredFromBackup}.`);
      })
      .catch((e) => {
        setNotice(`Could not load workspace: ${String(e)}`);
        useBoard.getState().hydrate(useBoard.getState().board);
      });
  }, []);

  useBoardRuntime();
  useAutosave();

  if (!loaded) return <div className="splash">Agent Board</div>;
  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar />
        <div className="app-body">
          <Rail />
          <main className="stage">
            {notice && (
              <div className="notice" role="status">
                {notice}
                <button className="btn ghost sm" onClick={() => setNotice(null)}>
                  Dismiss
                </button>
              </div>
            )}
            <Board />
            <Dock />
          </main>
        </div>
        {ui.settingsOpen && <SettingsPanel onClose={() => useBoard.getState().setUi({ settingsOpen: false })} />}
        {ui.memoryOpen && <MemoryPanel onClose={() => useBoard.getState().setUi({ memoryOpen: false })} />}
      </div>
    </ReactFlowProvider>
  );
}

// App shell. CONTRACT: the mount points below are fixed; each feature owns its component.
import { useLoops } from "../features/loops/useLoops";
import { useOrchestrator } from "../features/orchestrator/useOrchestrator";
import { lazy, Suspense, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { Board } from "../features/board/Board";
import { TopBar } from "../features/shell/TopBar";
import { Rail } from "../features/shell/Rail";
import { Dock } from "../features/dock/Dock";
import { ExtensionsPanel } from "../features/extensions/ExtensionsPanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { MemoryPanel } from "../features/dock/MemoryPanel";
import { UsageAnalytics } from "../features/usage/UsageAnalytics";
import { useSessionUsagePoller } from "../features/usage/sessionUsage";
import { UsageModal } from "../features/usage/UsageModal";
const CodePanel = lazy(() => import("../features/code/CodePanel").then((m) => ({ default: m.CodePanel })));
import { useBoardRuntime } from "../features/console/useBoardRuntime";
import { useAutosave } from "../features/board/useAutosave";
import { resumeAll } from "../features/console/launch";
import { ipc } from "../lib/ipc";
import { useBoard } from "../store/board";
import { useTileOps } from "../features/links/useTileOps";
import { UpdatePrompt } from "../features/updater/UpdatePrompt";
import { useUpdaterBoot } from "../features/updater/store";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { AddConsoleModal } from "../features/console/AddConsoleModal";

export function App() {
  const loaded = useBoard((s) => s.loaded);
  const ui = useBoard((s) => s.ui);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const settingsP = ipc
      .loadSettings()
      .then(({ settings, resolvedCwd }) => {
        useBoard.getState().setSettings(settings, resolvedCwd);
        return settings;
      })
      .catch(() => null);
    const boardP = ipc
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
    // Settings toggle: once the board is loaded and on screen, relaunch resumable consoles.
    void Promise.all([settingsP, boardP]).then(([s]) => {
      if (!s?.autoResume) return;
      window.setTimeout(() => {
        void resumeAll().then((n) => {
          if (n) setNotice(`Resumed ${n} console${n === 1 ? "" : "s"}.`);
        });
      }, 400);
    });
  }, []);

  useBoardRuntime();
  useAutosave();
  useLoops();
  useTileOps();
  useUpdaterBoot();
  useSessionUsagePoller();
  useOrchestrator();

  if (!loaded) return <div className="splash">Agent Board</div>;
  return (
    <MotionConfig reducedMotion="user">
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
        <Suspense fallback={null}>
        <AnimatePresence>
          {ui.settingsOpen && <SettingsPanel key="settings" onClose={() => useBoard.getState().setUi({ settingsOpen: false })} />}
          {ui.codeOpen && <CodePanel key="code" onClose={() => useBoard.getState().setUi({ codeOpen: false, codeTarget: null })} />}
          {ui.extensionsOpen && <ExtensionsPanel key="extensions" tab={ui.extensionsOpen} onClose={() => useBoard.getState().setUi({ extensionsOpen: null })} />}
          {ui.memoryOpen && <MemoryPanel key="memory" onClose={() => useBoard.getState().setUi({ memoryOpen: false })} />}
          {ui.usageModal && <UsageModal key="usage-modal" consoleId={ui.usageModal.consoleId} onClose={() => useBoard.getState().setUi({ usageModal: null })} />}
          {ui.usageAnalyticsOpen && <UsageAnalytics key="usage-analytics" onClose={() => useBoard.getState().setUi({ usageAnalyticsOpen: false })} />}
        </AnimatePresence>
        </Suspense>
        {ui.addConsole && (
          <AddConsoleModal
            targetPos={ui.addConsole.pos}
            targetGroup={ui.addConsole.group}
            onClose={() => useBoard.getState().setUi({ addConsole: null })}
          />
        )}
        <UpdatePrompt />
        <ConfirmDialog />
      </div>
    </ReactFlowProvider>
    </MotionConfig>
  );
}

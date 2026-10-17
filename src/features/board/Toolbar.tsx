import { useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { AgentKind, Detected } from "../../lib/types";
import { nextPosition, statusCounts, useBoard } from "../../store/board";

export function Toolbar() {
  const [det, setDet] = useState<Detected | null>(null);
  const counts = useBoard(useShallow((s) => statusCounts(s.runtime)));
  const flow = useReactFlow();

  useEffect(() => {
    ipc.detectAgents().then(setDet).catch(() => undefined);
  }, []);

  const add = async (agent: AgentKind) => {
    const dir = await open({ directory: true, title: "Working directory for this console" });
    if (typeof dir !== "string") return;
    const id = await ipc.newConsoleId();
    const existing = useBoard.getState().workspace.consoles;
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? "console";
    const pos = nextPosition(existing);
    useBoard.getState().addConsole({ id, title: name, agent, cwd: dir, ...pos, width: 720, height: 440 });
    setTimeout(() => flow.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1 }), 50);
  };

  return (
    <header className="toolbar">
      <strong className="brand">Agent Board</strong>
      <div className="row">
        <button disabled={det?.claude === false} title={det?.claude === false ? "claude not found on PATH" : ""} onClick={() => void add({ kind: "claudeCode" })}>
          + Claude Code
        </button>
        <button disabled={det?.codex === false} title={det?.codex === false ? "codex not found on PATH" : ""} onClick={() => void add({ kind: "codex" })}>
          + Codex
        </button>
        <button onClick={() => det && void add({ kind: "custom", program: det.shell })}>+ Shell</button>
      </div>
      <div className="row counts">
        <span className="pill working">{counts.working} working</span>
        <span className="pill needs">{counts.needsYou} needs you</span>
        <span className="pill resting">{counts.resting} resting</span>
        <button onClick={() => flow.fitView({ duration: 300 })}>Fit all</button>
      </div>
    </header>
  );
}

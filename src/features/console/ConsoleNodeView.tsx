import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ConsoleFlowNode } from "../board/nodes";
import { agentLabel, useBoard } from "../../store/board";
import { ipc } from "../../lib/ipc";
import { STATUS_COLOR, STATUS_LABEL } from "./statusStyle";
import { TerminalView } from "./TerminalView";

export const ConsoleNodeView = memo(function ConsoleNodeView({
  data,
  selected,
}: NodeProps<ConsoleFlowNode>) {
  const c = data.console;
  const rt = useBoard((s) => s.runtime[c.id]);
  const status = rt?.running ? rt.status : "exited";
  const [editing, setEditing] = useState(false);

  const close = async () => {
    if (rt?.running) {
      const ok = await ask(`Stop "${c.title}" and remove it from the board?`, {
        title: "Close console",
        kind: "warning",
      });
      if (!ok) return;
      await ipc.kill(c.id).catch(() => undefined);
    }
    useBoard.getState().removeConsole(c.id);
  };

  return (
    <div className={`console ${status === "needsYou" ? "attention" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} />
      <div className="console-header">
        <span className="dot" style={{ background: STATUS_COLOR[status] }} title={STATUS_LABEL[status]} />
        {editing ? (
          <input
            className="title-input nodrag"
            autoFocus
            defaultValue={c.title}
            onBlur={(e) => {
              useBoard.getState().patchConsole(c.id, { title: e.target.value.trim() || c.title });
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="title" onDoubleClick={() => setEditing(true)}>
            {c.title}
          </span>
        )}
        <span className="meta">
          {agentLabel(c.agent)} · {STATUS_LABEL[status]}
        </span>
        <span className="cwd" title={c.cwd}>
          {c.cwd}
        </span>
        <button className="icon nodrag" onClick={close} title="Close">
          ×
        </button>
      </div>
      <div className="console-body nodrag nowheel nopan">
        <TerminalView console={c} />
      </div>
    </div>
  );
});

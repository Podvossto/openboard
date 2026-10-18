import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ConsoleFlowNode } from "../board/nodes";
import { agentShort, displayStatus, useBoard } from "../../store/board";
import { ipc } from "../../lib/ipc";
import { STATUS_LABEL } from "./statusStyle";
import { TerminalView } from "./TerminalView";
import { ConsoleMenu } from "./ConsoleMenu";
import { useNeedsYouAlert } from "./useNeedsYouAlert";
import { shortPath } from "./helpers";
import "./console.css";

export const ConsoleNodeView = memo(function ConsoleNodeView({ data, selected }: NodeProps<ConsoleFlowNode>) {
  const c = data.console;
  const rt = useBoard((s) => s.runtime[c.id]);
  const blink = useBoard((s) => s.settings.blinkNeedsYou);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const status = displayStatus(rt);
  const [editing, setEditing] = useState(false);
  useNeedsYouAlert(c.id, c.title);

  const remove = async () => {
    if (rt?.running) {
      const ok = await ask(`Stop "${c.title}" and remove it from the board?`, {
        title: "Remove console",
        kind: "warning",
      });
      if (!ok) return;
      await ipc.kill(c.id).catch(() => undefined);
    }
    useBoard.getState().removeConsole(c.id);
  };

  const commit = (value: string) => {
    const t = value.trim();
    if (t && t !== c.title) useBoard.getState().patchConsole(c.id, { title: t });
    setEditing(false);
  };

  const cwdText = c.cwd ? shortPath(c.cwd) : shortPath(resolvedCwd);
  const attention = status === "needsYou" && blink;

  return (
    <div className={`console${selected ? " selected" : ""}${attention ? " attention" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} />
      <div className="console-header">
        <span className={`status-dot ${status}`} title={STATUS_LABEL[status]} />
        {editing ? (
          <input
            className="title-input nodrag"
            autoFocus
            defaultValue={c.title}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="title" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {c.title}
          </span>
        )}
        <span className="agent-badge">{agentShort(c.agent)}</span>
        <span className={`cwd${c.cwd ? "" : " dim"}`} title={c.cwd || resolvedCwd}>
          {cwdText}
        </span>
        <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>
        <ConsoleMenu c={c} onRename={() => setEditing(true)} onClose={remove} />
      </div>
      <div className="console-body nodrag nowheel nopan">
        <TerminalView console={c} />
      </div>
    </div>
  );
});

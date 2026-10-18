import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ConsoleFlowNode } from "../board/nodes";
import { displayStatus, useBoard } from "../../store/board";
import { AgentIcon } from "../../components/AgentIcon";
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

  const tint =
    c.agent.kind === "claudeCode" ? "var(--color-claude)" : c.agent.kind === "codex" ? "var(--color-codex)" : "var(--color-ink-3)";
  const statusTone: Record<string, string> = {
    working: "border-info/40 bg-info/10 text-info",
    resting: "border-ok/35 bg-ok/10 text-ok",
    needsYou: "border-warn/60 bg-warn/15 text-warn",
    starting: "border-line text-ink-3",
    exited: "border-line text-ink-3",
  };

  return (
    <div
      className={`console group/console${selected ? " selected" : ""}${attention ? " attention" : ""}`}
      style={{ ["--tint" as string]: tint }}
    >
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} lineClassName="!border-accent/40" handleClassName="!size-2.5 !rounded-full !border-0 !bg-accent" />
      <div className="console-header flex h-11 shrink-0 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-black/30">
          <AgentIcon agent={c.agent.kind} size={16} />
        </span>
        {editing ? (
          <input
            className="nodrag h-7 w-36 rounded-full border border-accent/70 bg-bg px-3 text-[13px] font-semibold text-ink outline-none"
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
          <span className="min-w-0 max-w-[40%] truncate text-[13.5px] font-semibold text-ink" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {c.title}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${c.cwd ? "text-ink-3" : "italic text-ink-3/70"}`}
          title={c.cwd || resolvedCwd}
        >
          {cwdText}
        </span>
        <span className={`pill ${status} flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold ${statusTone[status]}`}>
          <span className={`status-dot ${status} size-1.5 rounded-full bg-current`} />
          {STATUS_LABEL[status]}
        </span>
        <ConsoleMenu c={c} onRename={() => setEditing(true)} onClose={remove} />
      </div>
      <div className="console-body nodrag nowheel nopan">
        <TerminalView console={c} />
      </div>
    </div>
  );
});

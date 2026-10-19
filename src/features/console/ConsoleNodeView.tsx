import { memo, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { ask } from "../../lib/dialog";
import type { ConsoleFlowNode } from "../board/nodes";
import { displayStatus, useBoard } from "../../store/board";
import { ConsoleAgentIcon } from "../../components/AgentIcon";
import { ipc } from "../../lib/ipc";
import { STATUS_COLOR, STATUS_LABEL } from "./statusStyle";
import { AnimatePresence, motion } from "motion/react";
import { nodeVariants, spring } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import { TerminalView } from "./TerminalView";
import { ConsoleMenu } from "./ConsoleMenu";
import { useNeedsYouAlert } from "./useNeedsYouAlert";
import { shortPath } from "./helpers";
import { useConsoleUsage } from "../usage/sessionUsage";
import { humanTokens } from "../usage/calc";
import "./console.css";

export const ConsoleNodeView = memo(function ConsoleNodeView({ data, selected, dragging: dragging_ }: NodeProps<ConsoleFlowNode>) {
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
    removeAnimated("console", c.id);
  };

  const commit = (value: string) => {
    const t = value.trim();
    if (t && t !== c.title) useBoard.getState().patchConsole(c.id, { title: t });
    setEditing(false);
  };

  const cwdText = c.cwd ? shortPath(c.cwd) : shortPath(resolvedCwd);
  const attention = status === "needsYou" && blink;

  const pulsing = useBoard((s) => (s.pulses[c.id] ?? 0) > 0);
  const profile = useBoard((s) => (c.profile ? s.settings.profiles?.find((p) => p.id === c.profile) : undefined));
  const tint =
    c.agent.kind === "claudeCode" ? "var(--color-claude)" : c.agent.kind === "codex" ? "var(--color-codex)" : "var(--color-ink-3)";

  const used = useConsoleUsage(c.agentSession, c.agent.kind);
  const leaving = useBoard((s) => !!s.leaving[c.id]);
  const dragging = !!dragging_;

  return (
    <motion.div
      className={`console group/console${selected ? " selected" : ""}${attention ? " attention" : ""}${pulsing ? " pulsing" : ""}`}
      style={{ ["--tint" as string]: tint, ["--status" as string]: STATUS_COLOR[status] }}
      variants={nodeVariants}
      initial="initial"
      animate={leaving ? "exit" : "animate"}
      whileHover={dragging ? undefined : { y: -2, transition: spring.snappy }}
      data-status={status}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(`open-console-menu-${c.id}`));
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={360}
        minHeight={220}
        lineClassName="!border-transparent"
        handleClassName="console-handle"
      />
      <div className="console-header flex h-10 shrink-0 cursor-grab items-center gap-2 pl-3 pr-1.5 active:cursor-grabbing">
        <StatusDot status={status} />
        <span className="grid size-6 shrink-0 place-items-center">
          <ConsoleAgentIcon agent={c.agent} size={15} />
        </span>
        {editing ? (
          <input
            className="nodrag h-7 w-36 rounded-md border border-accent/70 bg-bg px-2 text-[13px] font-semibold text-ink outline-none"
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
          <span className="min-w-0 max-w-[38%] truncate text-[13px] font-semibold text-ink" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {c.title}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${c.cwd ? "text-ink-3" : "italic text-ink-3/70"}`}
          title={c.cwd || resolvedCwd}
        >
          {cwdText}
        </span>
        <AnimatePresence initial={false}>
          {c.lead && (
            <Badge key="lead" className="border-warn/45 bg-warn/10 text-warn" title="Orchestrator lead — can list, message, read and spawn other consoles">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z" /></svg>
              Lead
            </Badge>
          )}
          {used && used.tokens > 0 && (
            <Badge
              key="tok"
              className="console-tokens border-line bg-surface-2 !normal-case !tracking-normal font-mono text-ink-2"
              title={`${used.tokens.toLocaleString()} tokens this session · ${used.messages} messages — click for usage`}
              aria-label={`${humanTokens(used.tokens)} tokens`}
              onClick={() => useBoard.getState().setUi({ usageModal: { consoleId: c.id } })}
              style={{ cursor: "pointer" }}
            >
              {humanTokens(used.tokens)} tok
            </Badge>
          )}
          {profile && (
            <Badge key="profile" title={`Account: ${profile.name}`} style={{ borderColor: `color-mix(in srgb, ${profile.color} 45%, transparent)`, color: profile.color }}>
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: profile.color }} />
              <span className="max-w-24 truncate">{profile.name}</span>
            </Badge>
          )}
          {c.loop?.enabled && (
            <Badge
              key="loop"
              className="border-accent/40 bg-accent/10 text-accent"
              title={`Loop: ${c.loop.message} · ${c.loop.runs}${c.loop.maxRuns ? `/${c.loop.maxRuns}` : ""} runs`}
              aria-label="Loop running"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="animate-spin [animation-duration:3s]">
                <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
              </svg>
              {c.loop.runs}
              {c.loop.maxRuns ? `/${c.loop.maxRuns}` : ""}
            </Badge>
          )}
        </AnimatePresence>
        <StatusChip status={status} />
        <ConsoleMenu c={c} onRename={() => setEditing(true)} onClose={remove} />
      </div>
      {/* invisible anchors for orchestrator edges */}
      <Handle type="target" position={Position.Left} className="console-anchor" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="console-anchor" isConnectable={false} />
      {/* drag from here onto a kanban / checklist / calendar tile to give this agent tools for it */}
      <Handle
        id="link"
        type="source"
        position={Position.Right}
        className="console-link-handle"
        title="Drag onto a Kanban, Checklist or Calendar to link it to this agent"
        aria-label="Link to a tile"
      />
      <div className="console-body nodrag nowheel nopan">
        <TerminalView console={c} />
      </div>
    </motion.div>
  );
});

/** Status chip that morphs (width + colour + label crossfade) between states. */
function StatusChip({ status }: { status: string }) {
  return (
    <motion.span
      layout
      transition={spring.layout}
      className="status-chip flex h-[22px] shrink-0 items-center overflow-hidden rounded-md border px-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]"
      animate={{
        color: STATUS_COLOR[status as keyof typeof STATUS_COLOR],
        borderColor: `color-mix(in srgb, ${STATUS_COLOR[status as keyof typeof STATUS_COLOR]} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[status as keyof typeof STATUS_COLOR]} 10%, transparent)`,
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={status}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={spring.snappy}
        >
          {STATUS_LABEL[status as keyof typeof STATUS_LABEL]}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

/** Live dot: breathes while working, rings while it needs you. */
function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status as keyof typeof STATUS_COLOR];
  return (
    <span className="relative grid size-2.5 shrink-0 place-items-center" aria-hidden="true">
      {(status === "working" || status === "needsYou") && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: color }}
          animate={{ scale: [1, 2.4], opacity: [0.55, 0] }}
          transition={{ duration: status === "needsYou" ? 1.1 : 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.span className="relative size-2 rounded-full" animate={{ backgroundColor: color }} transition={{ duration: 0.25 }} />
    </span>
  );
}

function Badge({ children, className = "", ...rest }: React.ComponentProps<typeof motion.span>) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={spring.snappy}
      className={`flex h-[22px] shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${className}`}
      {...rest}
    >
      {children}
    </motion.span>
  );
}

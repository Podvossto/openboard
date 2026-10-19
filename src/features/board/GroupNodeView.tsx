import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ask } from "../../lib/dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { GroupFlowNode } from "./nodes";
import { nextSlotInGroup, groupHeightFor } from "./grouping";
import { activeWorkspace, GROUP_COLORS, statusCounts, useBoard } from "../../store/board";
import { ipc } from "../../lib/ipc";
import { useDismiss } from "../dock/useDismiss";
import { focusCommandBar } from "../dock/commandBus";
import { motion } from "motion/react";
import { spring } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import { terminalControls } from "../console/controls";

export const GroupNodeView = memo(function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>) {
  const g = data.group;
  const leaving = useBoard((s) => !!s.leaving[g.id]);
  const memberIds = useBoard((s) =>
    activeWorkspace(s.board)
      .consoles.filter((c) => c.group === g.id)
      .map((c) => c.id)
      .join(","),
  );
  const runtime = useBoard((s) => s.runtime);
  const ids = memberIds ? memberIds.split(",") : [];
  const counts = statusCounts(runtime, ids);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"main" | "color" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menu !== null, [menuRef, popRef], closeMenu);

  const changeGroupCwd = async () => {
    setMenu(null);
    const st = useBoard.getState();
    const ws = activeWorkspace(st.board);
    const members = ws.consoles.filter((c) => c.group === g.id);
    if (!members.length) return;

    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: `Select working directory for ${g.name}`,
    }).catch(() => null);

    if (typeof picked !== "string") return;

    const runningMembers = members.filter((c) => st.runtime[c.id]?.running);
    const confirmMsg = runningMembers.length > 0
      ? `Change working directory of all ${members.length} console(s) in "${g.name}" to:\n${picked}\n\nRestart ${runningMembers.length} running agent(s) now?`
      : `Change working directory of all ${members.length} console(s) in "${g.name}" to:\n${picked}`;

    const ok = await ask(confirmMsg, { title: "Group working directory", kind: "info" });
    if (!ok) return;

    for (const c of members) st.patchConsole(c.id, { cwd: picked });
    // restart running members in parallel (each relaunch is independent)
    // start() stops the old process itself before relaunching in the new folder
    await Promise.all(runningMembers.map((c) => terminalControls.get(c.id)?.start(false)));
  };

  /** Opens the New console dialog targeted at the next free slot in this group. */
  const addConsole = () => {
    const st = useBoard.getState();
    const members = activeWorkspace(st.board).consoles.filter((c) => c.group === g.id);
    const slot = nextSlotInGroup(members, g);
    const need = groupHeightFor(slot.y);
    if (need > g.height) st.patchGroup(g.id, { height: need });
    st.setUi({ addConsole: { pos: { x: slot.x, y: slot.y }, group: g.id } });
  };

  const removeAll = async () => {
    setMenu(null);
    const st = useBoard.getState();
    const members = activeWorkspace(st.board).consoles.filter((c) => c.group === g.id);
    const ok = await ask(`Remove group "${g.name}" and its ${members.length} console(s)? Running ones will be stopped.`, {
      title: "Remove group",
      kind: "warning",
    });
    if (!ok) return;
    for (const c of members) {
      if (st.runtime[c.id]?.running) await ipc.kill(c.id).catch(() => undefined);
      st.removeConsole(c.id);
    }
    removeAnimated("group", g.id);
  };

  const mentionName = g.name.replace(/\s+/g, "-");

  return (
    <motion.div
      className={`group-frame ${selected ? "selected" : ""}`}
      style={{ ["--gc" as string]: g.color }}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={leaving ? { opacity: 0, scale: 0.97, transition: { duration: 0.18 } } : { opacity: 1, scale: 1, transition: spring.soft }}
    >
      <NodeResizer isVisible={selected} minWidth={320} minHeight={160} lineStyle={{ borderColor: g.color }} handleClassName="!size-2.5 !rounded-full !border-0" handleStyle={{ background: g.color }} />
      <div className="group-header flex h-11 cursor-grab items-center gap-2.5 pl-4 pr-2 active:cursor-grabbing">
        <span className="size-2.5 shrink-0 rounded-full shadow-[0_0_10px_var(--gc)]" style={{ background: g.color }} />
        {editing ? (
          <input
            className="nodrag h-7 w-44 rounded-full border border-accent/70 bg-bg px-3 text-[13px] font-semibold text-ink outline-none"
            autoFocus
            defaultValue={g.name}
            onBlur={(e) => {
              useBoard.getState().patchGroup(g.id, { name: e.target.value.trim() || g.name });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            className="gname max-w-[260px] truncate text-[13px] font-bold uppercase tracking-[0.08em]"
            style={{ color: g.color }}
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {g.name}
          </span>
        )}
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold text-ink-2">{ids.length}</span>
        <span className="flex gap-1">
          {counts.working > 0 && <Mini tone="bg-info" n={counts.working} />}
          {counts.needsYou > 0 && <Mini tone="bg-warn" n={counts.needsYou} />}
          {counts.resting > 0 && <Mini tone="bg-ok" n={counts.resting} />}
        </span>
        <span className="flex-1" />
        <button
          className="nodrag grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95"
          title="Add console to this group"
          aria-label="Add console"
          onClick={addConsole}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <button
          className="nodrag ring-pill !h-7 !px-3 !text-[12px]"
          style={{ ["--ring-a" as string]: g.color, ["--ring-b" as string]: "#8ea2ff" }}
          title={`Send a message to every console in ${g.name}`}
          onClick={() => focusCommandBar(`@${mentionName} `)}
        >
          Broadcast
        </button>
        <div className="menu-anchor nodrag" ref={menuRef}>
          <button
            className="grid size-7 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95"
            title="Group menu"
            aria-label="Group menu"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={() => setMenu(menu ? null : "main")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menu !== null && (
            <FloatingMenu anchor={menuRef} popRef={popRef}>
          {menu === "main" && (
            <div className="menu glass animate-pop !static !rounded-xl !border-line" role="menu">
              <button className="menu-item" role="menuitem" onClick={() => { setMenu(null); setEditing(true); }}>
                Rename
              </button>
              <button className="menu-item" role="menuitem" onClick={() => setMenu("color")}>
                Change color
              </button>
              <button className="menu-item" role="menuitem" onClick={() => void changeGroupCwd()} disabled={ids.length === 0}>
                Set working directory…
              </button>
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => { setMenu(null); removeAnimated("group", g.id); }}
              >
                Ungroup
              </button>
              <div className="menu-sep" />
              <button className="menu-item danger" role="menuitem" onClick={removeAll}>
                Remove group + consoles
              </button>
            </div>
          )}
          {menu === "color" && (
            <div className="menu color-menu glass animate-pop !static !rounded-xl !border-line" role="menu">
              <div className="swatches">
                {GROUP_COLORS.map((col) => (
                  <button
                    key={col}
                    className={`swatch-btn ${col === g.color ? "on" : ""}`}
                    style={{ background: col }}
                    aria-label={`Color ${col}`}
                    onClick={() => { useBoard.getState().patchGroup(g.id, { color: col }); setMenu(null); }}
                  />
                ))}
              </div>
            </div>
          )}
            </FloatingMenu>
          )}
        </div>
      </div>
    </motion.div>
  );
});

/** Renders the group menu on <body> so member consoles (drawn above the group frame) can't cover it. */
export function FloatingMenu({ anchor, popRef, children }: { anchor: React.RefObject<HTMLDivElement | null>; popRef: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [anchor]);
  if (!pos) return null;
  return createPortal(
    <div ref={popRef} className="nodrag fixed z-[80]" style={{ top: pos.top, right: pos.right }}>
      {children}
    </div>,
    document.body,
  );
}

function Mini({ tone, n }: { tone: string; n: number }) {
  return (
    <span className="flex h-5 items-center gap-1 rounded-full bg-surface-3/80 px-1.5 text-[11px] font-semibold text-ink-2">
      <span className={`size-1.5 rounded-full ${tone}`} />
      {n}
    </span>
  );
}

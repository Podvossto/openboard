import { memo, useCallback, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { GroupFlowNode } from "./nodes";
import { nextSlotInGroup, groupHeightFor } from "./grouping";
import { activeWorkspace, CONSOLE_H, CONSOLE_W, GROUP_COLORS, statusCounts, useBoard } from "../../store/board";
import { autoStart } from "../../lib/actions";
import { ipc } from "../../lib/ipc";
import { useDismiss } from "../dock/useDismiss";
import { focusCommandBar } from "../dock/commandBus";

export const GroupNodeView = memo(function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>) {
  const g = data.group;
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
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menu !== null, menuRef, closeMenu);

  const addConsole = async () => {
    const st = useBoard.getState();
    const ws = activeWorkspace(st.board);
    const members = ws.consoles.filter((c) => c.group === g.id);
    const slot = nextSlotInGroup(members, g);
    const id = await ipc.newId();
    const agent = st.settings.defaultAgent;
    const n = ws.consoles.length + 1;
    autoStart.add(id);
    const need = groupHeightFor(slot.y);
    if (need > g.height) st.patchGroup(g.id, { height: need });
    st.addConsoles([
      {
        id,
        title: `${agent.kind === "claudeCode" ? "claude" : agent.kind === "codex" ? "codex" : "shell"}-${n}`,
        agent,
        cwd: "",
        ...slot,
        width: CONSOLE_W,
        height: CONSOLE_H,
        group: g.id,
      },
    ]);
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
    st.removeGroup(g.id);
  };

  const mentionName = g.name.replace(/\s+/g, "-");

  return (
    <div className={`group-frame ${selected ? "selected" : ""}`} style={{ ["--gc" as string]: g.color }}>
      <NodeResizer isVisible={selected} minWidth={320} minHeight={160} lineStyle={{ borderColor: g.color }} />
      <div className="group-header">
        <span className="swatch" style={{ background: g.color }} />
        {editing ? (
          <input
            className="input title-input nodrag"
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
          <span className="gname" title="Double-click to rename" onDoubleClick={() => setEditing(true)}>
            {g.name}
          </span>
        )}
        <span className="gcount">{ids.length}</span>
        <span className="gstatus">
          {counts.working > 0 && <span className="pill working"><span className="dot" />{counts.working}</span>}
          {counts.needsYou > 0 && <span className="pill needsYou"><span className="dot" />{counts.needsYou}</span>}
          {counts.resting > 0 && <span className="pill resting"><span className="dot" />{counts.resting}</span>}
        </span>
        <span className="spacer" />
        <button className="btn sm icon ghost nodrag" title="Add console to this group" aria-label="Add console" onClick={addConsole}>
          +
        </button>
        <button
          className="btn sm ghost nodrag"
          title={`Send a message to every console in ${g.name}`}
          onClick={() => focusCommandBar(`@${mentionName} `)}
        >
          Broadcast
        </button>
        <div className="menu-anchor nodrag" ref={menuRef}>
          <button
            className="btn sm icon ghost"
            title="Group menu"
            aria-label="Group menu"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={() => setMenu(menu ? null : "main")}
          >
            …
          </button>
          {menu === "main" && (
            <div className="menu" role="menu">
              <button className="menu-item" role="menuitem" onClick={() => { setMenu(null); setEditing(true); }}>
                Rename
              </button>
              <button className="menu-item" role="menuitem" onClick={() => setMenu("color")}>
                Change color
              </button>
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => { setMenu(null); useBoard.getState().removeGroup(g.id); }}
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
            <div className="menu color-menu" role="menu">
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
        </div>
      </div>
    </div>
  );
});

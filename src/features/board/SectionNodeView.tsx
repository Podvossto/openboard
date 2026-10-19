import { memo, useCallback, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { ask } from "../../lib/dialog";
import { ipc } from "../../lib/ipc";
import { spring } from "../../lib/motion";
import { removeAnimated } from "../../lib/removeAnimated";
import { activeWorkspace, useBoard } from "../../store/board";
import { useDismiss } from "../dock/useDismiss";
import { FloatingMenu } from "./GroupNodeView";
import { SECTION_COLORS } from "./sections";
import type { SectionFlowNode } from "./nodes";

/**
 * Section frame. The node wrapper ignores pointer events (see board.css) so the empty interior
 * still pans the canvas; only the title pill (drag handle) and resize handles are interactive.
 */
export const SectionNodeView = memo(function SectionNodeView({ data, selected }: NodeProps<SectionFlowNode>) {
  const s = data.section;
  const leaving = useBoard((st) => !!st.leaving[s.id]);
  const hot = useBoard((st) => st.sectionHot === s.id);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"main" | "color" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menu !== null, [menuRef, popRef], closeMenu);

  const removeWithContents = async () => {
    setMenu(null);
    const st = useBoard.getState();
    const ws = activeWorkspace(st.board);
    const groups = ws.groups.filter((g) => g.section === s.id).map((g) => g.id);
    const consoles = ws.consoles.filter((c) => c.section === s.id || (c.group && groups.includes(c.group)));
    const tiles = (ws.tiles ?? []).filter((t) => t.section === s.id || (t.group && groups.includes(t.group)));
    const ok = await ask(
      `Remove section "${s.name}" with ${consoles.length} console(s), ${groups.length} group(s) and ${tiles.length} tile(s)? Running consoles will be stopped.`,
      { title: "Remove section + contents", kind: "warning" },
    );
    if (!ok) return;
    for (const c of consoles) {
      if (st.runtime[c.id]?.running) await ipc.kill(c.id).catch(() => undefined);
      st.removeConsole(c.id);
    }
    for (const t of tiles) st.removeTile(t.id);
    for (const g of groups) st.removeGroup(g);
    removeAnimated("section", s.id);
  };

  const keepContents = async () => {
    setMenu(null);
    const ws = activeWorkspace(useBoard.getState().board);
    const n = ws.consoles.filter((c) => c.section === s.id).length + ws.groups.filter((g) => g.section === s.id).length + (ws.tiles ?? []).filter((t) => t.section === s.id).length;
    if (n > 0) {
      const ok = await ask(`Remove section "${s.name}"? Its ${n} item(s) stay on the board.`, { title: "Remove section", kind: "info" });
      if (!ok) return;
    }
    removeAnimated("section", s.id);
  };

  return (
    <motion.div
      className={`section-frame ${selected ? "selected" : ""} ${hot ? "hot" : ""}`}
      data-section={s.id}
      data-hot={hot ? "1" : undefined}
      style={{ ["--sc" as string]: s.color }}
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1, transition: leaving ? { duration: 0.18 } : spring.soft }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={200}
        lineStyle={{ borderColor: s.color }}
        handleClassName="!size-2.5 !rounded-full !border-0"
        handleStyle={{ background: s.color }}
      />
      <div className="section-header flex h-8 cursor-grab items-center gap-1.5 pl-3 pr-1 active:cursor-grabbing">
        <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
        {editing ? (
          <input
            aria-label="Section name"
            className="nodrag h-6 w-40 rounded-full border border-accent/70 bg-bg px-2.5 text-[12px] font-semibold text-ink outline-none"
            autoFocus
            defaultValue={s.name}
            onBlur={(e) => {
              useBoard.getState().patchSection(s.id, { name: e.target.value.trim() || s.name });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            className="section-name max-w-[320px] truncate text-[12px] font-bold uppercase tracking-[0.08em]"
            style={{ color: s.color }}
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {s.name}
          </span>
        )}
        <div className="menu-anchor nodrag" ref={menuRef}>
          <button
            className="grid size-6 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95"
            title="Section menu"
            aria-label="Section menu"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={() => setMenu(menu ? null : "main")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menu !== null && (
            <FloatingMenu anchor={menuRef} popRef={popRef}>
              {menu === "main" && (
                <div className="menu glass animate-pop !static !rounded-xl !border-line" role="menu" aria-label="Section menu">
                  <button className="menu-item" role="menuitem" onClick={() => { setMenu(null); setEditing(true); }}>Rename</button>
                  <button className="menu-item" role="menuitem" onClick={() => setMenu("color")}>Change color</button>
                  <button className="menu-item" role="menuitem" onClick={() => void keepContents()}>Remove section (keep contents)</button>
                  <div className="menu-sep" />
                  <button className="menu-item danger" role="menuitem" onClick={() => void removeWithContents()}>Remove section + contents</button>
                </div>
              )}
              {menu === "color" && (
                <div className="menu color-menu glass animate-pop !static !rounded-xl !border-line" role="menu">
                  <div className="swatches">
                    {SECTION_COLORS.map((col) => (
                      <button
                        key={col}
                        className={`swatch-btn ${col === s.color ? "on" : ""}`}
                        style={{ background: col }}
                        aria-label={`Color ${col}`}
                        onClick={() => { useBoard.getState().patchSection(s.id, { color: col }); setMenu(null); }}
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

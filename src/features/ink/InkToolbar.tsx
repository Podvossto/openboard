import { useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { activeWorkspace, useBoard, type InkTool } from "../../store/board";

export const INK_COLORS = ["#f4f4f6", "#ffb547", "#ff6b6b", "#4fd1a1", "#8ea2ff", "#e57ad8"];
const WIDTHS = [2, 4, 8];
export const DEFAULT_PEN: InkTool = { mode: "pen", color: INK_COLORS[1]!, width: 4 };

/** Floating ink toolbar (top centre) while drawing. */
export function InkToolbar() {
  const tool = useBoard((s) => s.ui.ink);
  const count = useBoard((s) => (activeWorkspace(s.board).ink ?? []).length);
  useEffect(() => {
    if (!tool) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const ui = useBoard.getState().ui.ink;
      if (!ui) return;
      if (e.key === "Escape") useBoard.getState().setUi({ ink: null });
      else if (e.key === "p" || e.key === "P") useBoard.getState().setUi({ ink: { ...ui, mode: "pen" } });
      else if (e.key === "e" || e.key === "E") useBoard.getState().setUi({ ink: { ...ui, mode: "eraser" } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);
  if (!tool) return null;
  const set = (p: Partial<InkTool>) => useBoard.getState().setUi({ ink: { ...tool, ...p } });
  const btn = (on: boolean) =>
    `grid size-8 place-items-center rounded-full transition ${on ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`;
  return (
    <div role="toolbar" aria-label="Ink" className="glass animate-pop absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5">
      <button className={btn(tool.mode === "pen")} aria-pressed={tool.mode === "pen"} aria-label="Pen" title="Pen (P)" onClick={() => set({ mode: "pen" })}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" /></svg>
      </button>
      <button className={btn(tool.mode === "eraser")} aria-pressed={tool.mode === "eraser"} aria-label="Eraser" title="Eraser (E)" onClick={() => set({ mode: "eraser" })}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 20h12M5 15l9-9 5 5-9 9H8z" /></svg>
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      {INK_COLORS.map((c) => (
        <button
          key={c}
          aria-label={`Color ${c}`}
          aria-pressed={tool.color === c}
          className="grid size-8 place-items-center rounded-full transition hover:bg-surface-2"
          onClick={() => set({ color: c, mode: "pen" })}
        >
          <span className={`size-4 rounded-full transition ${tool.color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`} style={{ background: c }} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      {WIDTHS.map((w) => (
        <button key={w} className={btn(tool.width === w)} aria-label={`Width ${w}`} aria-pressed={tool.width === w} onClick={() => set({ width: w, mode: "pen" })}>
          <span className="rounded-full bg-current" style={{ width: w + 2, height: w + 2 }} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <button
        className="h-8 rounded-full px-3 text-[12px] font-semibold text-ink-2 transition hover:bg-surface-2 hover:text-danger disabled:opacity-40"
        disabled={!count}
        onClick={async () => {
          if (await ask(`Erase all ${count} strokes on this workspace?`, { title: "Clear ink", kind: "warning" })) useBoard.getState().clearInk();
        }}
      >
        Clear
      </button>
      <button className="h-8 rounded-full bg-ink px-3.5 text-[12px] font-semibold text-bg transition hover:bg-white active:scale-95" onClick={() => useBoard.getState().setUi({ ink: null })}>
        Done
      </button>
    </div>
  );
}

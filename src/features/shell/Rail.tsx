import { useCallback, useRef, useState, type ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard } from "../../store/board";
import { addTile } from "../tiles/addTile";
import { TILE_META } from "../tiles/logic";
import { TileIcon } from "../tiles/TileIcon";
import { useDismiss } from "../dock/useDismiss";
import { DEFAULT_PEN } from "../ink/InkToolbar";
import type { AgentPreset, TileKind } from "../../lib/types";
import { createFromPreset } from "../../lib/actions";
import { PresetIcon } from "../presets/PresetIcon";
import { PresetEditor } from "../presets/PresetEditor";
import { AnimatePresence } from "motion/react";

const KINDS: { kind: TileKind; hint: string }[] = [
  { kind: "note", hint: "Sticky note" },
  { kind: "checklist", hint: "Tasks you can send to an agent" },
  { kind: "kanban", hint: "Columns of draggable cards" },
  { kind: "web", hint: "Live localhost preview" },
  { kind: "git", hint: "Branch, changes, commit / push / pull" },
  { kind: "calendar", hint: "Month / week events" },
];

function AddTileButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  useDismiss(open, ref, close);
  return (
    <div className="relative" ref={ref}>
      <RailButton label="Add tile" active={open} onClick={() => setOpen((o) => !o)}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        <path d="M12 8v8M8 12h8" />
      </RailButton>
      {open && (
        <div role="menu" aria-label="Add tile" className="glass animate-pop absolute left-[calc(100%+10px)] top-0 z-50 w-64 rounded-2xl p-1.5">
          {KINDS.map(({ kind, hint }) => (
            <button
              key={kind}
              role="menuitem"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-3"
              onClick={() => {
                setOpen(false);
                void addTile(kind, rf);
              }}
            >
              <span className="grid size-8 place-items-center rounded-lg border border-line bg-black/30">
                <TileIcon kind={kind} size={16} />
              </span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-ink">{TILE_META[kind].label}</span>
                <span className="text-[11.5px] text-ink-3">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`rail-btn relative grid size-10 place-items-center rounded-full transition duration-150 active:scale-95 ${
        active
          ? "active bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong),0_0_16px_-6px_var(--color-accent)]"
          : "text-ink-3 hover:bg-surface-2 hover:text-ink"
      }`}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <svg className="size-[19px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function InkButton() {
  const on = useBoard((s) => !!s.ui.ink);
  return (
    <RailButton label="Draw" active={on} onClick={() => useBoard.getState().setUi({ ink: on ? null : DEFAULT_PEN })}>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M14 6l3 3" />
    </RailButton>
  );
}

/** Item 3: the user's agent presets — click = new console, right-click = edit, + = create. */
function PresetRail() {
  const presets = useBoard((s) => s.settings.agentPresets ?? []);
  const [editing, setEditing] = useState<AgentPreset | "new" | null>(null);
  return (
    <div className="flex flex-col items-center gap-1.5" aria-label="Agent presets" role="group">
      {presets.map((p) => (
        <button
          key={p.id}
          className="group relative grid size-10 place-items-center rounded-xl border transition hover:scale-105 active:scale-95"
          style={{ borderColor: `${p.color}66`, background: `${p.color}1a` }}
          title={`${p.name} — click to start · right-click to edit`}
          aria-label={`Start ${p.name}`}
          data-preset={p.id}
          onClick={() => void createFromPreset(p)}
          onContextMenu={(e) => {
            e.preventDefault();
            setEditing(p);
          }}
        >
          <PresetIcon icon={p.icon} size={19} agent={p.agent} />
          <span className="pointer-events-none absolute left-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-[11.5px] text-ink shadow-lg group-hover:block">
            {p.name}
          </span>
        </button>
      ))}
      <button
        className="grid size-10 place-items-center rounded-xl border border-dashed border-line-strong text-ink-3 transition hover:border-accent hover:text-ink"
        title="New agent preset (name, icon, CLI, role, skills, MCP)"
        aria-label="New agent preset"
        onClick={() => setEditing("new")}
      >
        <svg className="size-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="8" r="3.5" />
          <path d="M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.2 0 2.3.3 3.2.8M18 14v6M15 17h6" />
        </svg>
      </button>
      <AnimatePresence>{editing && <PresetEditor preset={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}</AnimatePresence>
    </div>
  );
}

export function Rail() {
  const memoryOpen = useBoard((s) => s.ui.memoryOpen);
  const settingsOpen = useBoard((s) => s.ui.settingsOpen);
  const codeOpen = useBoard((s) => s.ui.codeOpen);
  const ext = useBoard((s) => s.ui.extensionsOpen);
  const setUi = useBoard.getState().setUi;

  return (
    <nav className="rail flex w-16 shrink-0 flex-col items-center gap-2 border-r border-line/60 bg-bg py-4" aria-label="Main">
      <RailButton label="Board" active={!memoryOpen && !settingsOpen && !codeOpen && !ext}>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="5" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="10" width="8" height="11" rx="2" />
      </RailButton>
      <AddTileButton />
      <InkButton />
      <RailButton label="Code" active={codeOpen} onClick={() => setUi({ codeOpen: true })}>
        <path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13.5 5l-3 14" />
      </RailButton>
      <RailButton label="Memory" active={memoryOpen} onClick={() => setUi({ memoryOpen: true })}>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h7M9 17h5" />
      </RailButton>
      {/* item 12: one entry for Skills & MCP (tabs inside) */}
      <RailButton label="Skills & MCP" active={!!ext} onClick={() => setUi({ extensionsOpen: "skills" })}>
        <path d="M12 3l2.4 5.2 5.6.7-4.1 3.9 1.1 5.6L12 15.6 7 18.4l1.1-5.6L4 8.9l5.6-.7z" />
      </RailButton>
      <div className="my-1 h-px w-8 bg-line/70" aria-hidden="true" />
      <PresetRail />
      <div className="flex-1" />
    </nav>
  );
}

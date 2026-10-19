import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { spring } from "../../lib/motion";
import { ask } from "../../lib/dialog";
import { ipc } from "../../lib/ipc";
import type { AccountUsage, Usage, Workspace } from "../../lib/types";
import { UpdateButton } from "../updater/UpdatePrompt";
import { activeWorkspace, statusCounts, useBoard } from "../../store/board";
import { cleanName, formatReset, nextInCycle, nextWorkspaceName, pct, usageLabel, usageLevel, usageTooltip } from "./format";

const USAGE_POLL_MS = 5 * 60 * 1000;

function Tab({ ws, active, canRemove }: { ws: Workspace; active: boolean; canRemove: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ws.name);

  const commit = () => {
    const n = cleanName(draft, ws.name);
    if (n) useBoard.getState().renameWorkspace(ws.id, n);
    setEditing(false);
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canRemove) return;
    if (ws.consoles.length > 0) {
      const ok = await ask(`Remove "${ws.name}" and its ${ws.consoles.length} console(s)? Running agents will stop.`, {
        title: "Remove workspace",
        kind: "warning",
      }).catch(() => false);
      if (!ok) return;
      await Promise.all(ws.consoles.map((c) => ipc.kill(c.id).catch(() => undefined)));
    }
    useBoard.getState().removeWorkspace(ws.id);
  };

  const count = ws.consoles.length;

  if (editing) {
    return (
      <input
        className="ws-tab-input h-7 w-32 rounded-full border border-accent/70 bg-bg px-3 text-[13px] font-semibold text-ink outline-none"
        value={draft}
        autoFocus
        aria-label="Workspace name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className={`ws-tab group/tab relative flex h-8 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-all duration-150 ${
        active
          ? "active text-ink border border-accent/75 bg-surface-3 shadow-[0_0_12px_-4px_var(--color-accent)] font-semibold"
          : "text-ink-3 hover:bg-surface-2 hover:text-ink border border-transparent"
      }`}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title="Double-click to rename"
      onClick={() => useBoard.getState().setActive(ws.id)}
      onDoubleClick={() => {
        setDraft(ws.name);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") useBoard.getState().setActive(ws.id);
        if (e.key === "F2") {
          setDraft(ws.name);
          setEditing(true);
        }
      }}
    >
      <span className="relative truncate">{ws.name}</span>
      <span className={`rounded-full px-1.5 py-0.2 font-mono text-[10.5px] tabular-nums ${active ? "bg-accent/20 text-accent font-semibold" : "bg-surface-3 text-ink-3"}`}>
        ({count})
      </span>
      {canRemove && (
        <button
          className="relative ml-0.5 grid size-4 place-items-center rounded-full text-ink-3 opacity-60 transition hover:bg-danger/20 hover:text-danger group-hover/tab:opacity-100"
          aria-label={`Remove workspace ${ws.name}`}
          title="Remove workspace"
          onClick={remove}
        >
          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function UsageBars({ u, color }: { u: Usage; color: string }) {
  return (
    <span className="flex w-8 flex-col gap-[2.5px]" aria-hidden="true">
      {[u.session?.percent, u.weekly?.percent].map((v, i) => (
        <span key={i} className="h-[2.5px] overflow-hidden rounded-full bg-surface-3">
          <i className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct(v)}%`, background: color }} />
        </span>
      ))}
    </span>
  );
}

const RING: Record<"danger" | "warn" | "ok" | "idle", [string, string]> = {
  danger: ["#ff6b6b", "#ff9b6b"],
  warn: ["#ffb547", "#f2d45a"],
  ok: ["#4fd1a1", "#56d8c9"],
  idle: ["#6a6b78", "#6a6b78"],
};

/** Top-bar usage pill styled per reference image: resets indicator + click opens analytics */
function UsagePill() {
  const [all, setAll] = useState<AccountUsage[] | null>(null);
  const open = useBoard((s) => !!s.ui.usageModal);

  useEffect(() => {
    let alive = true;
    const load = () =>
      ipc
        .usageAll()
        .then((u) => alive && setAll(u))
        .catch(() => alive && setAll([]));
    load();
    const t = setInterval(load, USAGE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!all) return null;
  const readable = all.filter((a) => !a.usage.error);
  const main = all.find((a) => a.id === "default-claude" && !a.usage.error) ?? readable[0];
  if (!main) return null;
  const level = usageLevel(main.usage);
  const ring = RING[level];
  const resetStr = formatReset(main.usage.session) || formatReset(main.usage.weekly);

  return (
    <div className="relative">
      <button
        className="usage-pill flex h-8 items-center gap-2 rounded-full border border-line bg-surface-2 px-3 text-[12px] font-medium text-ink transition hover:bg-surface-3 hover:border-line-strong active:scale-95"
        title={usageTooltip(main.usage) + " — click for usage & analytics"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Usage"
        onClick={() => useBoard.getState().setUi({ usageModal: open ? null : {} })}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span className="text-[#e8784b] text-[13px] leading-none font-bold" aria-hidden="true">✳</span>
        <UsageBars u={main.usage} color={ring[0]} />
        <span className="tabular-nums text-ink font-semibold">{usageLabel(main.usage, shortName(main))}</span>
        {resetStr && <span className="text-ink-3 text-[11px] truncate">{resetStr}</span>}
      </button>

    </div>
  );
}

const shortName = (a: AccountUsage) =>
  a.id === "default-claude" ? "Claude" : a.id === "default-codex" ? "Codex" : a.name.split(/[ ·(]/)[0] || a.name;

export function TopBar() {
  const board = useBoard((s) => s.board);
  const runtime = useBoard((s) => s.runtime);
  const showUsage = useBoard((s) => s.settings.showUsage);
  const { fitView } = useReactFlow();
  const ws = activeWorkspace(board);
  const ids = useMemo(() => ws.consoles.map((c) => c.id), [ws.consoles]);
  const counts = statusCounts(runtime, ids);
  /** running PTYs on every workspace (the per-status pills are for the active one) */
  const live = Object.values(runtime).filter((r) => r?.running).length;
  const needsIds = ids.filter((id) => runtime[id]?.running && runtime[id]?.status === "needsYou");
  const lastJump = useRef<string | null>(null);

  const jumpNext = useCallback(() => {
    const target = nextInCycle(needsIds, lastJump.current ?? useBoard.getState().focused);
    if (!target) return;
    lastJump.current = target;
    useBoard.getState().setFocused(target);
    void fitView({ nodes: [{ id: target }], duration: 300, maxZoom: 1 });
  }, [needsIds, fitView]);

  const addWs = () => {
    void ipc.newId().then((id) =>
      useBoard.getState().addWorkspace({
        id,
        name: nextWorkspaceName(board.workspaces),
        viewport: { x: 0, y: 0, zoom: 1 },
        consoles: [],
        groups: [],
        memory: "",
      }),
    );
  };

  const pill = (tone: "working" | "needsYou" | "resting", n: number, label: string, onClick?: () => void) => {
    const color = tone === "working" ? "bg-info" : tone === "needsYou" ? "bg-warn" : "bg-ok";
    const hot = tone === "needsYou" && n > 0;
    const Tag = onClick ? "button" : "span";
    return (
      <Tag
        className={`pill ${tone} flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold tabular-nums transition ${
          hot
            ? "cursor-pointer border-warn/50 bg-warn/10 text-warn shadow-[0_0_18px_-6px_var(--color-warn)] hover:bg-warn/20 [animation:needs-pulse_2s_ease-in-out_infinite]"
            : n === 0
              ? "zero border-line/70 text-ink-3 opacity-60"
              : "border-line bg-surface-2 text-ink"
        }`}
        title={onClick ? `${n} need you — click to jump to the next` : `${n} ${label}`}
        aria-label={onClick ? `${n} consoles need you, jump to next` : undefined}
        onClick={onClick}
      >
        <span className={`size-2 rounded-full ${color} ${tone === "working" && n > 0 ? "animate-pulse" : ""}`} />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={n} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={spring.snappy}>
            {n}
          </motion.span>
        </AnimatePresence>
        <span className="font-medium text-ink-3">{label}</span>
      </Tag>
    );
  };

  return (
    <header className="topbar relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line/60 bg-bg px-4">
      {/* Tabs section */}
      <div className="ws-tabs flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Workspaces">
        {board.workspaces.map((w) => (
          <Tab key={w.id} ws={w} active={w.id === board.active} canRemove={board.workspaces.length > 1} />
        ))}
        <button
          className="grid size-8 shrink-0 place-items-center rounded-full border border-line/60 text-ink-3 transition hover:bg-surface-2 hover:text-ink hover:border-line active:scale-95"
          onClick={addWs}
          title="New workspace"
          aria-label="New workspace"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Right section: Live status, status pills, usage, actions */}
      <div className="flex shrink-0 items-center gap-2">
        {live > 0 && (
          <span
            className="flex h-8 items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 text-[12px] font-semibold text-ok tabular-nums"
            title={`${live} running across all workspaces`}
          >
            <span className="size-2 rounded-full bg-ok animate-pulse" />
            <span>{live} live</span>
          </span>
        )}
        {pill("working", counts.working, "working")}
        {pill("needsYou", counts.needsYou, "need you", counts.needsYou > 0 ? jumpNext : undefined)}
        {pill("resting", counts.resting, "resting")}
        <UpdateButton />
        {showUsage && <UsagePill />}

        <div className="mx-1 h-5 w-px bg-line/60" />

        {/* Action icons per reference image */}
        <button
          className="grid size-8 place-items-center rounded-full border border-line bg-surface-2 text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95"
          title="Skills & MCP Tools"
          aria-label="Skills & MCP"
          onClick={() => useBoard.getState().setUi({ extensionsOpen: "skills" })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
          </svg>
        </button>

        <button
          className="grid size-8 place-items-center rounded-full border border-line bg-surface-2 text-ink-3 transition hover:bg-surface-3 hover:text-ink active:scale-95"
          title="Settings"
          aria-label="Settings"
          onClick={() => useBoard.getState().setUi({ settingsOpen: true })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

        <div className="grid size-8 place-items-center rounded-full border border-accent/40 bg-accent/15 text-accent text-[11px] font-bold select-none cursor-pointer hover:brightness-110" title="User Profile">
          AB
        </div>
      </div>
    </header>
  );
}

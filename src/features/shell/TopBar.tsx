import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { Usage, Workspace } from "../../lib/types";
import { activeWorkspace, statusCounts, useBoard } from "../../store/board";
import { cleanName, nextInCycle, nextWorkspaceName, pct, usageLabel, usageLevel, usageTooltip } from "./format";


const USAGE_POLL_MS = 5 * 60 * 1000;

function BrandMark() {
  return (
    <svg className="size-[22px] text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="9" height="8" rx="2" fill="currentColor" />
      <rect x="13" y="3" width="9" height="5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2" y="13" width="9" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="10" width="9" height="11" rx="2" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

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
      className={`ws-tab group/tab relative flex h-8 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded-full pl-3.5 pr-1.5 text-[13px] font-medium transition-all duration-150 ${active ? "active bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`}
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
      <span className="truncate">{ws.name}</span>
      <button
        className="grid size-5 place-items-center rounded-full text-ink-3 opacity-0 transition hover:bg-danger/15 hover:text-danger group-hover/tab:opacity-100 focus-visible:opacity-100 disabled:hidden"
        disabled={!canRemove}
        aria-label={`Remove workspace ${ws.name}`}
        title={canRemove ? "Remove workspace" : "Can't remove the only workspace"}
        onClick={remove}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function UsagePill() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      ipc
        .claudeUsage()
        .then((u) => alive && setUsage(u))
        .catch((e) => alive && setUsage({ session: null, weekly: null, error: String(e) }));
    load();
    const t = setInterval(load, USAGE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!usage || usage.error === "not logged in") return null;
  const level = usage.error ? "idle" : usageLevel(usage);
  const ring =
    level === "danger" ? ["#ff6b6b", "#ff9b6b"] : level === "warn" ? ["#ffb547", "#f2d45a"] : level === "ok" ? ["#4fd1a1", "#56d8c9"] : ["#6a6b78", "#6a6b78"];
  return (
    <span
      className="usage-pill ring-pill !h-8 !cursor-default !gap-2.5 !px-3 !text-[12px]"
      style={{ ["--ring-a" as string]: ring[0], ["--ring-b" as string]: ring[1] }}
      title={usageTooltip(usage)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="#e8784b" /></svg>
      {usage.error ? (
        <span className="text-ink-2">Claude —</span>
      ) : (
        <>
          <span className="flex w-9 flex-col gap-[3px]" aria-hidden="true">
            {[usage.session?.percent, usage.weekly?.percent].map((v, i) => (
              <span key={i} className="h-[3px] overflow-hidden rounded-full bg-surface-3">
                <i className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct(v)}%`, background: ring[0] }} />
              </span>
            ))}
          </span>
          <span className="tabular-nums text-ink">{usageLabel(usage)}</span>
        </>
      )}
    </span>
  );
}

export function TopBar() {
  const board = useBoard((s) => s.board);
  const runtime = useBoard((s) => s.runtime);
  const showUsage = useBoard((s) => s.settings.showUsage);
  const { fitView } = useReactFlow();
  const ws = activeWorkspace(board);
  const ids = useMemo(() => ws.consoles.map((c) => c.id), [ws.consoles]);
  const counts = statusCounts(runtime, ids);
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
        className={`pill ${tone} flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-semibold tabular-nums transition ${
          hot
            ? "cursor-pointer border-warn/50 bg-warn/10 text-warn shadow-[0_0_18px_-6px_var(--color-warn)] hover:bg-warn/20 [animation:needs-pulse_2s_ease-in-out_infinite]"
            : n === 0
              ? "zero border-line text-ink-3"
              : "border-line bg-surface-2 text-ink"
        }`}
        title={onClick ? `${n} need you — click to jump to the next` : `${n} ${label}`}
        aria-label={onClick ? `${n} consoles need you, jump to next` : undefined}
        onClick={onClick}
      >
        <span className={`size-2 rounded-full ${color} ${tone === "working" && n > 0 ? "animate-pulse" : ""}`} />
        {n}
        <span className="font-medium text-ink-3">{label}</span>
      </Tag>
    );
  };

  return (
    <header className="topbar relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-line/60 bg-bg px-4">
      <div className="flex shrink-0 items-center gap-2.5 text-[14px] font-semibold tracking-tight text-ink">
        <BrandMark />
        <span>Agent Board</span>
      </div>

      <div className="mx-1 h-5 w-px bg-line" />

      <div className="ws-tabs flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Workspaces">
        {board.workspaces.map((w) => (
          <Tab key={w.id} ws={w} active={w.id === board.active} canRemove={board.workspaces.length > 1} />
        ))}
        <button
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-surface-2 hover:text-ink active:scale-95"
          onClick={addWs}
          title="New workspace"
          aria-label="New workspace"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {pill("working", counts.working, "working")}
        {pill("needsYou", counts.needsYou, "need you", counts.needsYou > 0 ? jumpNext : undefined)}
        {pill("resting", counts.resting, "resting")}
        {showUsage && <UsagePill />}
        <button
          className="grid size-9 place-items-center rounded-full border border-line text-ink-2 transition hover:border-line-strong hover:bg-surface-2 hover:text-ink active:scale-95"
          title="Settings"
          aria-label="Settings"
          onClick={() => useBoard.getState().setUi({ settingsOpen: true })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </button>
      </div>
    </header>
  );
}

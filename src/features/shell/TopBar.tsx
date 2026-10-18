import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { Usage, Workspace } from "../../lib/types";
import { activeWorkspace, statusCounts, useBoard } from "../../store/board";
import { cleanName, nextInCycle, nextWorkspaceName, pct, usageLabel, usageLevel, usageTooltip } from "./format";
import "./shell.css";

const USAGE_POLL_MS = 5 * 60 * 1000;

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
        className="input ws-tab-input"
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
      className={`ws-tab${active ? " active" : ""}`}
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
      <span className="ws-tab-name">{ws.name}</span>
      <button
        className="ws-tab-x"
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
  if (usage.error) {
    return (
      <span className="pill usage-pill" title={usageTooltip(usage)}>
        Claude —
      </span>
    );
  }
  return (
    <span className={`pill usage-pill ${usageLevel(usage)}`} title={usageTooltip(usage)}>
      <span className="bars" aria-hidden="true">
        <span className="bar">
          <i style={{ width: `${pct(usage.session?.percent)}%` }} />
        </span>
        <span className="bar">
          <i style={{ width: `${pct(usage.weekly?.percent)}%` }} />
        </span>
      </span>
      <span className="txt">{usageLabel(usage)}</span>
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

  const pill = (cls: string, n: number, label: string) => (
    <span className={`pill ${cls}${n === 0 ? " zero" : ""}`} title={`${n} ${label}`}>
      <span className="dot" />
      {n}
    </span>
  );

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span>Agent Board</span>
      </div>

      <div className="ws-tabs" role="tablist" aria-label="Workspaces">
        {board.workspaces.map((w) => (
          <Tab key={w.id} ws={w} active={w.id === board.active} canRemove={board.workspaces.length > 1} />
        ))}
        <button className="btn ghost icon" onClick={addWs} title="New workspace" aria-label="New workspace">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="topbar-right">
        {pill("working", counts.working, "working")}
        {counts.needsYou > 0 ? (
          <button
            className="pill needsYou clickable pulse"
            onClick={jumpNext}
            title={`${counts.needsYou} need you — click to jump to the next`}
            aria-label={`${counts.needsYou} consoles need you, jump to next`}
          >
            <span className="dot" />
            {counts.needsYou}
          </button>
        ) : (
          pill("needsYou", 0, "need you")
        )}
        {pill("resting", counts.resting, "resting")}
        {showUsage && <UsagePill />}
        <button
          className="btn ghost icon"
          title="Settings"
          aria-label="Settings"
          onClick={() => useBoard.getState().setUi({ settingsOpen: true })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

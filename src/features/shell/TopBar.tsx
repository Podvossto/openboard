import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { popVariants, spring } from "../../lib/motion";
import { ask } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import type { AccountUsage, Usage, Workspace } from "../../lib/types";
import { useDismiss } from "../dock/useDismiss";
import { activeWorkspace, statusCounts, useBoard } from "../../store/board";
import { cleanName, formatReset, nextInCycle, nextWorkspaceName, pct, usageLabel, usageLevel, usageTooltip } from "./format";


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
      className={`ws-tab group/tab relative flex h-8 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded-full pl-3.5 pr-1.5 text-[13px] font-medium transition-colors duration-150 ${active ? "active text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`}
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
      {active && (
        <motion.span
          layoutId="ws-tab-active"
          transition={spring.layout}
          className="absolute inset-0 -z-0 rounded-full bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        />
      )}
      <span className="relative truncate">{ws.name}</span>
      <button
        className="relative grid size-5 place-items-center rounded-full text-ink-3 opacity-0 transition hover:bg-danger/15 hover:text-danger group-hover/tab:opacity-100 focus-visible:opacity-100 disabled:hidden"
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

const PROVIDER_DOT: Record<string, string> = { anthropic: "#e8784b", openai: "#8aa4ff", zai: "#4fd1a1" };

function UsageBars({ u, color }: { u: Usage; color: string }) {
  return (
    <span className="flex w-9 flex-col gap-[3px]" aria-hidden="true">
      {[u.session?.percent, u.weekly?.percent].map((v, i) => (
        <span key={i} className="h-[3px] overflow-hidden rounded-full bg-surface-3">
          <i className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct(v)}%`, background: color }} />
        </span>
      ))}
    </span>
  );
}

const RING: Record<"danger" | "warn" | "ok" | "idle", [string, string]> = { danger: ["#ff6b6b", "#ff9b6b"], warn: ["#ffb547", "#f2d45a"], ok: ["#4fd1a1", "#56d8c9"], idle: ["#6a6b78", "#6a6b78"] };

/** Top-bar usage pill (default Claude) + popover with every account (Claude, Codex, Z.ai, extra logins). */
function UsagePill() {
  const [all, setAll] = useState<AccountUsage[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

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
  return (
    <div className="relative" ref={ref}>
      <button
        className="usage-pill ring-pill !h-8 !gap-2.5 !px-3 !text-[12px]"
        style={{ ["--ring-a" as string]: ring[0], ["--ring-b" as string]: ring[1] }}
        title={usageTooltip(main.usage)}
        aria-expanded={open}
        aria-label="Usage"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="size-2 rounded-full" style={{ background: PROVIDER_DOT[main.provider] ?? "#a9aab6" }} />
        <UsageBars u={main.usage} color={ring[0]} />
        <span className="tabular-nums text-ink">{usageLabel(main.usage, shortName(main))}</span>
        {readable.length > 1 && <span className="rounded-full bg-surface-3 px-1.5 text-[10.5px] text-ink-2">+{readable.length - 1}</span>}
      </button>
      <AnimatePresence>
      {open && (
        <motion.div
          variants={popVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ transformOrigin: "top right" }}
          role="dialog"
          aria-label="Usage by account"
          className="glass absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] rounded-2xl p-2"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Plan usage</div>
          {all.map((a) => {
            const lv = a.usage.error ? "idle" : usageLevel(a.usage);
            const c = RING[lv][0];
            return (
              <div key={a.id} className="rounded-xl px-2.5 py-2 hover:bg-surface-2/70">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: PROVIDER_DOT[a.provider] ?? "#a9aab6" }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{a.name}</span>
                  {a.usage.error && <span className="truncate text-[11.5px] text-ink-3">{a.usage.error}</span>}
                </div>
                {!a.usage.error && (
                  <div className="mt-1.5 grid grid-cols-2 gap-3 pl-4">
                    {(["session", "weekly"] as const).map((k) => {
                      const w = a.usage[k];
                      return (
                        <div key={k}>
                          <div className="flex items-baseline justify-between text-[11px]">
                            <span className="text-ink-3">{k === "session" ? "5-hour" : "Weekly"}</span>
                            <span className="font-semibold tabular-nums text-ink">{w ? `${pct(w.percent)}%` : "—"}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <i className="block h-full rounded-full" style={{ width: `${pct(w?.percent)}%`, background: c }} />
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-ink-3">{formatReset(w)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-1 border-t border-line px-1.5 pb-1 pt-1.5">
            <button
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold text-ink-2 transition hover:bg-surface-2 hover:text-ink active:scale-[0.99]"
              onClick={() => {
                setOpen(false);
                useBoard.getState().setUi({ usageAnalyticsOpen: true });
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="1" y="7" width="3" height="6" rx="1" fill="currentColor" />
                <rect x="5.5" y="4" width="3" height="9" rx="1" fill="currentColor" opacity="0.75" />
                <rect x="10" y="1" width="3" height="12" rx="1" fill="currentColor" opacity="0.5" />
              </svg>
              Analytics…
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
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

      </div>
    </header>
  );
}

// Usage window: per-account session gauge + weekly bars, activity heatmap and summary stats
// (local logs via board-core::analytics), plus a per-console section when opened from a console.
import { useEffect, useMemo, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import { fadeVariants, popVariants } from "../../lib/motion";
import { ipc } from "../../lib/ipc";
import type { AccountUsage, Analytics, UsageWindow } from "../../lib/types";
import { useBoard } from "../../store/board";
import { pct } from "../shell/format";
import {
  activeDaysLabel,
  favoriteModel,
  formatDuration,
  heatGrid,
  humanTokens,
  mostActiveDay,
  prettyDate,
  prettyModel,
  resetCaption,
  trimLeadingIdle,
} from "./calc";
import { useConsoleUsage, useSessionUsage } from "./sessionUsage";
import "./usage.css";

const RANGES = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "all", label: "All time", days: 365 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

/** Dark grey → bright orange, level 0…4. */
const HEAT = ["#26272d", "#5a3a2a", "#8f4f2c", "#cc6a2b", "#ff8a1f"];
const ORANGE = "#ff8a1f";
const CELL = 11;
const GAP = 3;
const LEFT = 28;
const TOP = 16;

function Glyphs() {
  return (
    <span className="flex items-center gap-1.5" aria-hidden="true">
      <span className="text-[13px] font-bold leading-none" style={{ color: "#e8784b" }}>✳</span>
      <span className="size-2.5 rounded-[3px] border-2" style={{ borderColor: "#8aa4ff" }} />
      <span className="size-2.5 rounded-full" style={{ background: "#4fd1a1" }} />
    </span>
  );
}

function Gauge({ percent }: { percent: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const v = pct(percent);
  return (
    <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`${v}% used`} className="shrink-0">
      <circle cx="52" cy="52" r={r} fill="none" stroke="#2a2b32" strokeWidth="9" />
      <circle
        data-testid="gauge-ring"
        cx="52"
        cy="52"
        r={r}
        fill="none"
        stroke={ORANGE}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`}
        transform="rotate(-90 52 52)"
        style={{ transition: "stroke-dasharray 500ms cubic-bezier(.2,.8,.2,1)" }}
      />
      <text x="52" y="52" textAnchor="middle" className="fill-ink" fontSize="19" fontWeight="700" dominantBaseline="central">
        {v}%
      </text>
    </svg>
  );
}

function Bar({ label, w, now, testid }: { label: string; w: Pick<UsageWindow, "percent" | "resetsAt">; now: number; testid: string }) {
  const cap = resetCaption(w.resetsAt, now);
  return (
    <div data-testid={testid}>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-2">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{pct(w.percent)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#26272d]">
        <i className="block h-full rounded-full" style={{ width: `${pct(w.percent)}%`, background: ORANGE, transition: "width 500ms cubic-bezier(.2,.8,.2,1)" }} />
      </div>
      <div className="mt-1 text-[11px] text-ink-3">{cap ?? "reset unknown"}</div>
    </div>
  );
}

function AccountPanel({ a, now }: { a: AccountUsage; now: number }) {
  const u = a.usage;
  if (u.error) return <p className="m-0 text-[13px] text-ink-3" data-testid="account-error">{a.name}: {u.error}</p>;
  return (
    <>
      <section className="flex items-center gap-5" data-testid="session-section">
        {u.session ? <Gauge percent={u.session.percent} /> : <Gauge percent={0} />}
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight text-ink">
            <span data-testid="session-pct">{u.session ? pct(u.session.percent) : "—"}</span>
            {u.session ? "% used" : ""}
          </div>
          <div className="text-[13px] text-ink-2">Current session</div>
          <div className="text-[11.5px] text-ink-3">{u.session ? (resetCaption(u.session.resetsAt, now) ?? "reset unknown") : "not reported"}</div>
        </div>
      </section>
      {(u.weekly || (u.weeklyModels?.length ?? 0) > 0) && (
        <section className="mt-5 flex flex-col gap-3.5" data-testid="weekly-section">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Weekly limits</h3>
          {u.weekly && <Bar testid="weekly-all" label="Current week (all models)" w={u.weekly} now={now} />}
          {(u.weeklyModels ?? []).map((m) => (
            <Bar key={m.model} testid={`weekly-${m.model.toLowerCase()}`} label={`Current week (${m.model})`} w={m} now={now} />
          ))}
        </section>
      )}
    </>
  );
}

function Heatmap({ days }: { days: Analytics["days"] }) {
  const g = useMemo(() => heatGrid(days), [days]);
  const W = LEFT + g.weeks * (CELL + GAP);
  const H = TOP + 7 * (CELL + GAP);
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Activity heatmap: ${days.length} days`} data-testid="heatmap">
        {g.months.map((m) => (
          <text key={`${m.col}-${m.label}`} x={LEFT + m.col * (CELL + GAP)} y={10} className="fill-ink-3" fontSize="9.5">
            {m.label}
          </text>
        ))}
        {[1, 3, 5].map((row) => (
          <text key={row} x={0} y={TOP + row * (CELL + GAP) + CELL - 2} className="fill-ink-3" fontSize="9.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row]}
          </text>
        ))}
        {g.cells.map((c) => (
          <rect
            key={c.date}
            className="usage-heat-cell"
            data-date={c.date}
            data-level={c.level}
            x={LEFT + c.col * (CELL + GAP)}
            y={TOP + c.row * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2.5}
            fill={HEAT[c.level]}
          >
            <title>{`${prettyDate(c.date)} — ${humanTokens(c.tokens)} tokens`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

function Stat({ id, label, value, sub }: { id: string; label: string; value: string; sub?: string }) {
  return (
    <div data-stat={id} className="min-w-0">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="truncate text-[15px] font-semibold text-ink">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function ConsoleCard({ consoleId }: { consoleId: string }) {
  const c = useBoard((s) => s.board.workspaces.flatMap((w) => w.consoles).find((x) => x.id === consoleId));
  const used = useConsoleUsage(c?.agentSession, c?.agent.kind ?? "");
  useEffect(() => {
    if (c?.agentSession) void useSessionUsage.getState().refresh([c.agentSession]);
  }, [c?.agentSession]);
  if (!c) return null;
  return (
    <section className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-3.5" data-testid="console-usage">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">This console</div>
      <div className="mt-1 text-[14px] font-semibold text-ink">{c.title}</div>
      {used ? (
        <div className="mt-2 grid grid-cols-3 gap-3">
          <Stat id="console-tokens" label="Tokens" value={humanTokens(used.tokens)} sub={used.tokens.toLocaleString()} />
          <Stat id="console-model" label="Model" value={used.model ? prettyModel(used.model) : "—"} />
          <Stat id="console-messages" label="Messages" value={String(used.messages)} />
        </div>
      ) : (
        <p className="m-0 mt-1 text-[12px] text-ink-3">
          {c.agent.kind === "claudeCode" ? "No usage logged for this session yet." : "Per-console usage is only tracked for Claude Code sessions."}
        </p>
      )}
    </section>
  );
}

export function UsageModal({ consoleId, onClose }: { consoleId?: string; onClose: () => void }) {
  const present = useIsPresent();
  const [all, setAll] = useState<AccountUsage[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [range, setRange] = useState<RangeId>("30d");
  const [data, setData] = useState<Analytics | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    ipc
      .usageAll()
      .then((u) => alive && setAll(u))
      .catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    const days = RANGES.find((r) => r.id === range)!.days;
    ipc
      .usageAnalytics(days)
      .then((a) => alive && setData(a))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [range]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = all?.find((a) => a.id === tab) ?? all?.find((a) => a.id === "default-claude" && !a.usage.error) ?? all?.[0];
  const days = useMemo(() => (data ? (range === "all" ? trimLeadingIdle(data.days) : data.days) : []), [data, range]);
  const peak = useMemo(() => mostActiveDay(days), [days]);
  const fav = favoriteModel(data?.models);

  return (
    <motion.div
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 ${present ? "" : "pointer-events-none"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        variants={popVariants}
        className="glass flex max-h-[calc(100vh-32px)] w-[600px] max-w-full flex-col overflow-hidden rounded-2xl shadow-[0_32px_80px_-20px_rgb(0_0_0/0.9)]"
        role={present ? "dialog" : undefined}
        aria-modal={present ? "true" : undefined}
        aria-label={present ? "Usage" : undefined}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="m-0 text-[14px] font-semibold lowercase tracking-tight text-ink">usage</h2>
          <Glyphs />
          <span className="flex-1" />
          <button
            className="h-7 rounded-full border border-line px-3 text-[11.5px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink"
            onClick={() => {
              onClose();
              // let the modal finish its exit before the sheet enters (same AnimatePresence)
              setTimeout(() => useBoard.getState().setUi({ usageAnalyticsOpen: true }), 220);
            }}
          >
            Details
          </button>
          <button
            className="grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink"
            onClick={onClose}
            aria-label="Close usage"
            title="Close (Esc)"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-4">
          {consoleId && <ConsoleCard consoleId={consoleId} />}

          {all && all.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Accounts">
              {all.map((a) => (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={a.id === current?.id}
                  className={`h-7 rounded-full border px-3 text-[12px] font-medium transition ${
                    a.id === current?.id ? "border-[#ff8a1f]/70 bg-[#ff8a1f]/10 text-ink" : "border-line text-ink-3 hover:bg-surface-2 hover:text-ink"
                  }`}
                  onClick={() => setTab(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {!all && <p className="m-0 text-[13px] text-ink-3">Loading…</p>}
          {all && !current && <p className="m-0 text-[13px] text-ink-3">No accounts found.</p>}
          {current && <AccountPanel a={current} now={now} />}

          <section className="mt-6" data-testid="activity-section">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="m-0 flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Activity</h3>
              <div className="period-seg" role="radiogroup" aria-label="Range">
                {RANGES.map((r) => (
                  <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? "on" : ""} onClick={() => setRange(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {data ? <Heatmap days={days} /> : <p className="m-0 text-[12px] text-ink-3">Reading local session logs…</p>}
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[10.5px] text-ink-3">
              <span>Less</span>
              {HEAT.map((h) => (
                <span key={h} className="size-[11px] rounded-[3px]" style={{ background: h }} />
              ))}
              <span>More</span>
            </div>
          </section>

          {data && (
            <section className="mt-5 grid grid-cols-3 gap-x-4 gap-y-4 border-t border-line pt-4" data-testid="summary">
              <Stat id="favorite-model" label="Favorite model" value={fav ? prettyModel(fav) : "—"} />
              <Stat id="total-tokens" label="Total tokens" value={humanTokens(data.totals.tokens)} />
              <Stat id="sessions" label="Sessions" value={String(data.totals.sessions)} />
              <Stat id="active-days" label="Active days" value={activeDaysLabel(days)} />
              <Stat id="most-active-day" label="Most active day" value={peak ? prettyDate(peak.date) : "—"} sub={peak ? `${humanTokens(peak.tokens)} tokens` : undefined} />
              <Stat id="longest-session" label="Longest session" value={formatDuration(data.longestSessionSecs)} />
            </section>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-4 py-2 font-mono text-[11px]">
          <span className="text-ink-2">
            <span style={{ color: "#e8784b" }}>✳</span> claude <span className="text-ink-3">&gt;</span> /usage
          </span>
          <span className="text-ink-3">your subscription · {all ? "refreshing" : "loading"}</span>
        </footer>
      </motion.div>
    </motion.div>
  );
}

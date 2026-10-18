// Usage analytics sheet: stat cards + stacked daily bars + activity heatmap,
// all from local session logs (board-core::analytics via the usage_analytics command).
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { ipc } from "../../lib/ipc";
import type { Analytics } from "../../lib/types";
import {
  agentColor,
  barPath,
  capitalize,
  dayTotal,
  formatTokens,
  heatLevel,
  niceCeil,
  prettyDate,
  stackOrder,
} from "./calc";
import "./usage.css";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Accent hue at rising opacity — one-hue sequential ramp, level 0 = idle. */
const HEAT_FILL = ["rgba(142,162,255,0.08)", "rgba(142,162,255,0.32)", "rgba(142,162,255,0.5)", "rgba(142,162,255,0.72)", "#8ea2ff"];

function StatCard({ stat, label, value, sub }: { stat: string; label: string; value: string; sub: string }) {
  return (
    <div className="stat-card" data-stat={stat}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

/** Hand-rolled stacked bar chart: one column per day, one segment per agent. */
function Bars({ days }: { days: Analytics["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680;
  const H = 196;
  const L = 40;
  const R = 8;
  const T = 8;
  const B = 22;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const max = Math.max(1, ...days.map(dayTotal));
  const niceMax = niceCeil(max);
  const slot = plotW / days.length;
  const bw = Math.min(24, Math.max(2, slot * 0.66));
  const baseline = T + plotH;
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const step = Math.max(1, Math.ceil(days.length / 5));

  const segsOf = (i: number) => {
    const d = days[i]!;
    const scale = plotH / niceMax;
    let acc = 0;
    return stackOrder(d.byAgent).map((agent) => {
      const h = (d.byAgent[agent] ?? 0) * scale;
      const y = baseline - acc - h;
      acc += h;
      return { agent, y, h };
    });
  };

  const tip = hover != null ? days[hover]! : null;
  const tipLeft = hover != null ? L + (hover + 0.5) * slot : 0;
  const tipShift = tipLeft > W - 90 ? "-88%" : tipLeft < 90 ? "-12%" : "-50%";

  return (
    <div className="chart-wrap">
      <svg
        className="usage-chart w-full"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Daily tokens for the last ${days.length} days, stacked by agent`}
        onPointerLeave={() => setHover(null)}
      >
        {/* recessive hairline gridlines + compact y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={baseline - (t / niceMax) * plotH} y2={baseline - (t / niceMax) * plotH} className="chart-grid" />
            <text x={L - 8} y={baseline - (t / niceMax) * plotH + 3} className="chart-tick" textAnchor="end">
              {formatTokens(t)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={baseline} y2={baseline} className="chart-grid" />
        <text x={L - 8} y={baseline + 3} className="chart-tick" textAnchor="end">0</text>

        {days.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const segs = segsOf(i);
          return (
            <g key={d.date} data-date={d.date}>
              {segs.map((s, j) => {
                // 2px surface gap between segments (skipped when a side is the baseline)
                const gapBelow = j > 0 && s.h > 3 ? 1 : 0;
                const gapAbove = j < segs.length - 1 && s.h > 3 ? 1 : 0;
                const h = Math.max(s.h - gapBelow - gapAbove, s.h > 0 ? 1 : 0);
                if (h <= 0) return null;
                const isTop = j === segs.length - 1;
                return (
                  <path
                    key={s.agent}
                    d={barPath(x, s.y + gapBelow, bw, h, isTop ? 3.5 : 0)}
                    fill={agentColor(s.agent)}
                    opacity={hover == null || hover === i ? 1 : 0.38}
                  />
                );
              })}
              {/* full-column hit target (bigger than the mark) */}
              <rect
                x={L + i * slot}
                y={T}
                width={slot}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
              />
            </g>
          );
        })}

        {days.map((d, i) =>
          i % step === 0 || i === days.length - 1 ? (
            <text key={`x${d.date}`} x={L + (i + 0.5) * slot} y={H - 6} className="chart-tick" textAnchor="middle">
              {prettyDate(d.date)}
            </text>
          ) : null,
        )}
      </svg>

      {tip && (
        <div className="usage-tip" style={{ left: `${(tipLeft / W) * 100}%`, transform: `translateX(${tipShift})` }} role="tooltip">
          <div className="usage-tip-date">
            {prettyDate(tip.date)} · {formatTokens(dayTotal(tip))} tokens
          </div>
          {stackOrder(tip.byAgent).map((a) => (
            <div key={a} className="usage-tip-row">
              <span className="size-2 rounded-full" style={{ background: agentColor(a) }} />
              <span className="usage-tip-agent">{capitalize(a)}</span>
              <span className="usage-tip-val">{formatTokens(tip.byAgent[a] ?? 0)}</span>
            </div>
          ))}
          <div className="usage-tip-meta">
            {tip.sessions} session{tip.sessions === 1 ? "" : "s"} · {tip.messages} message{tip.messages === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}

/** GitHub-style weeks × 7 days grid with 5 intensity levels. */
function Heatmap({ days }: { days: Analytics["days"] }) {
  const S = 13;
  const G = 3;
  const lead = new Date(`${days[0]!.date}T00:00:00`).getDay(); // Sunday-start columns
  const weeks = Math.ceil((lead + days.length) / 7);
  const max = Math.max(1, ...days.map(dayTotal));
  const rows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const W = weeks * (S + G) + 34;
  const H = 7 * (S + G) + 4;

  return (
    <div className="heat-wrap">
      <svg
        className="usage-heat"
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: `${W}px` }}
        role="img"
        aria-label={`Activity heatmap: ${days.length} days`}
      >
        {rows.map((r, dow) =>
          dow % 2 === 1 ? (
            <text key={r} x={0} y={dow * (S + G) + S - 2} className="chart-tick">
              {r}
            </text>
          ) : null,
        )}
        {Array.from({ length: weeks }, (_, w) =>
          Array.from({ length: 7 }, (_, dow) => {
            const i = w * 7 + dow - lead;
            const d = i >= 0 && i < days.length ? days[i]! : null;
            const cx = 34 + w * (S + G);
            const cy = dow * (S + G) + 2;
            if (!d) return <rect key={`${w}-${dow}`} x={cx} y={cy} width={S} height={S} rx={2.5} fill="transparent" />;
            const lv = heatLevel(dayTotal(d), max);
            return (
              <rect key={d.date} className="usage-heat-cell" data-date={d.date} x={cx} y={cy} width={S} height={S} rx={2.5} fill={HEAT_FILL[lv]}>
                <title>{`${prettyDate(d.date)} — ${formatTokens(dayTotal(d))} tokens`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="heat-legend">
        <span>Less</span>
        {HEAT_FILL.map((f, i) => (
          <span key={i} className="heat-swatch" style={{ background: f }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export function UsageAnalytics({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    ipc
      .usageAnalytics(period)
      .then((a) => alive && setData(a))
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [period]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const t = data?.totals;
  const agents = useMemo(() => {
    if (!data) return [];
    const sum: Record<string, number> = {};
    for (const d of data.days)
      for (const [a, v] of Object.entries(d.byAgent)) sum[a] = (sum[a] ?? 0) + v;
    return stackOrder(sum);
  }, [data]);

  const daysN = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  return (
    <motion.div
      className="usage-backdrop"
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.aside variants={sheetVariants} className="glass usage-panel" role="dialog" aria-modal="true" aria-label="Usage analytics">
        <header className="usage-head">
          <h2>Usage analytics</h2>
          <div className="period-seg" role="radiogroup" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} role="radio" aria-checked={period === p} className={period === p ? "on" : ""} onClick={() => setPeriod(p)}>
                {p}d
              </button>
            ))}
          </div>
          <button className="usage-close" onClick={onClose} aria-label="Close usage analytics" title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="usage-body">
          {err && <p className="usage-error">{err}</p>}
          {!data && !err && <p className="usage-error">Reading local session logs…</p>}
          {data && t && (
            <>
              <div className="stat-grid">
                <StatCard stat="total-tokens" label="Total tokens" value={formatTokens(t.tokens)} sub={`last ${data.days.length} days`} />
                <StatCard stat="sessions" label="Sessions" value={String(t.sessions)} sub="unique sessions" />
                <StatCard stat="messages" label="Messages" value={String(t.messages)} sub="assistant replies" />
                <StatCard stat="active-days" label="Active days" value={String(t.activeDays)} sub={`of ${data.days.length} days`} />
                <StatCard stat="current-streak" label="Current streak" value={daysN(data.streaks.current)} sub="consecutive active days" />
                <StatCard stat="longest-streak" label="Longest streak" value={daysN(data.streaks.longest)} sub="in this period" />
                <StatCard
                  stat="peak-day"
                  label="Peak day"
                  value={data.peakDay ? formatTokens(data.peakDay.tokens) : "—"}
                  sub={data.peakDay ? prettyDate(data.peakDay.date) : "no activity"}
                />
                <StatCard
                  stat="top-agent"
                  label="Top agent"
                  value={data.topAgent ? capitalize(data.topAgent.agent) : "—"}
                  sub={data.topAgent ? formatTokens(data.topAgent.tokens) : "no activity"}
                />
              </div>

              <section className="usage-section">
                <div className="usage-legend">
                  {agents.length > 0 ? (
                    agents.map((a) => (
                      <span key={a} className="usage-legend-item">
                        <span className="size-2 rounded-full" style={{ background: agentColor(a) }} />
                        {capitalize(a)}
                      </span>
                    ))
                  ) : (
                    <span className="usage-legend-item text-ink-3">No session activity in this period</span>
                  )}
                </div>
                <Bars days={data.days} />
              </section>

              <section className="usage-section">
                <Heatmap days={data.days} />
              </section>
            </>
          )}
        </div>
      </motion.aside>
    </motion.div>
  );
}

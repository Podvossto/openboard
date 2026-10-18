import { useCallback, useEffect, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import type { GitAction, GitBranch, GitGraph, GitStatus, Tile, TileData } from "../../lib/types";
import { changeBadge } from "./logic";
import { curvePath, GRAPH_LANE_W, GRAPH_ROW_H, isStaged, laneColor, laneX, rowY, stagedPaths } from "./gitGraph";

const TONE = {
  add: "text-ok",
  mod: "text-warn",
  del: "text-danger",
  conf: "text-danger",
  new: "text-info",
} as const;

type Tab = "changes" | "branches" | "graph";
const TABS: { id: Tab; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "branches", label: "Branches" },
  { id: "graph", label: "Graph" },
];

/** Live git card: stage/commit changes, switch + create branches, browse the lane graph. */
export function GitTile({ tile, setData }: { tile: Tile<"git">; setData: (d: TileData["git"]) => void }) {
  const cwd = tile.data.cwd ?? "";
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const [st, setSt] = useState<GitStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("changes");
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [graph, setGraph] = useState<GitGraph | null>(null);
  const [newBranch, setNewBranch] = useState("");

  const refresh = useCallback(async () => {
    setBusy((b) => b ?? "refresh");
    try {
      setSt(await ipc.gitStatus(cwd));
      setErr(null);
    } catch (e) {
      setSt(null);
      setErr(String(e));
    } finally {
      setBusy((b) => (b === "refresh" ? null : b));
    }
  }, [cwd]);

  useEffect(() => {
    setTab("changes");
    setBranches(null);
    setGraph(null);
    void refresh();
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // branches / graph load lazily when their tab is shown (and after branch actions)
  const loadBranches = useCallback(async () => {
    try {
      setBranches(await ipc.gitBranches(cwd));
    } catch (e) {
      setNote(String(e));
    }
  }, [cwd]);
  const loadGraph = useCallback(async () => {
    try {
      setGraph(await ipc.gitGraph(cwd, 60));
    } catch (e) {
      setNote(String(e));
    }
  }, [cwd]);

  useEffect(() => {
    if (tab === "branches" && !branches) void loadBranches();
    if (tab === "graph" && !graph) void loadGraph();
  }, [tab, branches, graph, loadBranches, loadGraph]);

  const run = async (action: GitAction) => {
    if (busy && busy !== "refresh") return;
    setBusy(action);
    setNote(null);
    try {
      const out = await ipc.gitRun(cwd, action, msg);
      setNote(out.trim().split("\n").slice(-1)[0] || `${action} done`);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const toggleStage = async (path: string, staged: boolean) => {
    if (busy) return;
    setBusy("stage");
    setNote(null);
    try {
      if (staged) await ipc.gitUnstage(cwd, [path]);
      else await ipc.gitStage(cwd, [path]);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const staged = st ? stagedPaths(st.changes) : [];
  const commitStaged = async () => {
    if (busy || !msg.trim() || staged.length === 0) return;
    setBusy("commit");
    setNote(null);
    try {
      const out = await ipc.gitCommit(cwd, msg);
      setMsg("");
      setNote(out.trim().split("\n").slice(-1)[0] || "committed");
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
      void refresh();
      void loadGraph();
    }
  };

  const checkoutBranch = async (b: GitBranch) => {
    if (b.current || (busy && busy !== "refresh")) return;
    const ok = await ask(`Checkout “${b.name}”? Uncommitted changes travel with the working tree.`, {
      title: "Checkout branch",
      kind: "info",
    });
    if (!ok) return;
    setBusy("checkout");
    setNote(null);
    try {
      await ipc.gitCheckout(cwd, b.name);
      setNote(`On ${b.name}`);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
      void refresh();
      void loadBranches();
      void loadGraph();
    }
  };

  const createBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBranch.trim();
    if (!name || (busy && busy !== "refresh")) return;
    setBusy("branch");
    setNote(null);
    try {
      await ipc.gitCreateBranch(cwd, name);
      setNewBranch("");
      setNote(`Created ${name}`);
    } catch (e2) {
      setNote(String(e2));
    } finally {
      setBusy(null);
      void loadBranches();
    }
  };

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, defaultPath: cwd || resolvedCwd || undefined });
    if (typeof dir === "string") setData({ cwd: dir });
  };

  const folderLabel = (cwd || resolvedCwd || "default folder").split(/[\\/]/).filter(Boolean).slice(-2).join("/");
  const working = !!(busy && busy !== "refresh");

  return (
    <div className="flex h-full flex-col text-[13px]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          className="min-w-0 truncate rounded-full border border-line px-2.5 py-0.5 font-mono text-[11.5px] text-ink-3 transition hover:border-line-strong hover:text-ink"
          title={`${cwd || resolvedCwd} — click to change`}
          onClick={() => void pickFolder()}
        >
          {folderLabel}
        </button>
        <span className="flex-1" />
        <button
          className={`grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink ${busy === "refresh" ? "animate-spin" : ""}`}
          aria-label="Refresh git status"
          title="Refresh"
          onClick={() => void refresh()}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
          </svg>
        </button>
      </div>

      {err ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-[12.5px] text-ink-3">
          <div>
            <div className="mb-1 font-semibold text-ink-2">Not a git repository</div>
            <div className="break-words">{err.replace(/^.*?git: /, "")}</div>
          </div>
        </div>
      ) : !st ? (
        <div className="grid flex-1 place-items-center text-ink-3">Reading repo…</div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 font-mono text-[12px] font-semibold text-ink" title={st.upstream ?? "no upstream"}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff8a5c" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="6" cy="6" r="2.2" />
                <circle cx="6" cy="18" r="2.2" />
                <circle cx="18" cy="8" r="2.2" />
                <path d="M6 8.2v7.6M18 10.2c0 4-6 3-11 6" />
              </svg>
              {st.branch || "(detached)"}
            </span>
            {st.upstream && (
              <span className="text-[11.5px] tabular-nums text-ink-3" aria-label="ahead behind">
                ↑{st.ahead} ↓{st.behind}
              </span>
            )}
            <span className="flex-1" />
            <span className="text-[11.5px] text-ink-3">
              {st.changes.length} changed{staged.length > 0 ? ` · ${staged.length} staged` : ""}
            </span>
          </div>

          <div role="tablist" aria-label="Git tile sections" className="flex items-center gap-1 px-2.5 pb-1 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition ${
                  tab === t.id ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2"
                } focus-visible:outline focus-visible:outline-accent/60`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "changes" && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1" aria-label="Changes">
                {st.changes.length === 0 && <div className="px-1.5 py-2 text-[12px] text-ink-3">Working tree clean</div>}
                <ul>
                  {st.changes.slice(0, 50).map((c) => {
                    const b = changeBadge(c.code);
                    const on = isStaged(c.code);
                    return (
                      <li key={c.code + c.path} className="flex items-center gap-2 rounded-md px-1.5 py-0.5 font-mono text-[12px] hover:bg-surface-2">
                        <input
                          type="checkbox"
                          aria-label={`Stage ${c.path}`}
                          title={on ? "staged — uncheck to unstage" : "check to stage for the next commit"}
                          checked={on}
                          disabled={working}
                          onChange={() => void toggleStage(c.path, on)}
                        />
                        <span className={`w-3 text-center font-bold ${TONE[b.tone]}`}>{b.label}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-2" title={c.path}>
                          {c.path}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex flex-col gap-2 border-t border-line p-2.5">
                <div className="flex gap-2">
                  <textarea
                    aria-label="Commit message"
                    className="h-9 min-w-0 flex-1 resize-none rounded-xl border border-line bg-bg/70 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70"
                    placeholder={`Commit message (${staged.length} staged)`}
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void commitStaged();
                      }
                    }}
                  />
                  <button
                    className="h-9 shrink-0 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-bg transition hover:bg-white active:scale-95 disabled:opacity-40"
                    disabled={!msg.trim() || staged.length === 0 || working}
                    title="Commit the staged files (nothing is added automatically)"
                    onClick={() => void commitStaged()}
                  >
                    {busy === "commit" ? "Committing…" : "Commit"}
                  </button>
                </div>
              </div>
            </>
          )}

          {tab === "branches" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ul aria-label="Branches">
                {(branches ?? []).map((b) => (
                  <li key={b.name} className="mb-1">
                    <button
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-[12.5px] transition focus-visible:outline focus-visible:outline-accent/60 ${
                        b.current ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      } disabled:opacity-40`}
                      aria-current={b.current || undefined}
                      disabled={b.current || working}
                      title={b.current ? "current branch" : `checkout ${b.name}`}
                      onClick={() => void checkoutBranch(b)}
                    >
                      <span className={`grid size-4 place-items-center text-[11px] ${b.current ? "text-ok" : "text-transparent"}`}>✓</span>
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      {b.current && <span className="shrink-0 rounded-full border border-line px-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">head</span>}
                    </button>
                  </li>
                ))}
                {branches?.length === 0 && <li className="px-1.5 text-[12px] text-ink-3">No branches</li>}
              </ul>
              <form className="flex gap-1.5 px-0.5 pt-1.5" onSubmit={(e) => void createBranch(e)}>
                <input
                  aria-label="New branch name"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg/60 px-2.5 font-mono text-[12px] outline-none placeholder:text-ink-3 focus:border-accent/70"
                  placeholder="new-branch…"
                  value={newBranch}
                  spellCheck={false}
                  onChange={(e) => setNewBranch(e.target.value)}
                />
                <button
                  className="h-8 rounded-lg bg-surface-3 px-3 text-[12px] font-semibold transition hover:bg-line-strong disabled:opacity-40"
                  type="submit"
                  disabled={!newBranch.trim() || working}
                  title="Create a branch at HEAD (stay on the current one)"
                >
                  Create
                </button>
              </form>
            </div>
          )}

          {tab === "graph" && (
            <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Commit graph">
              {!graph ? (
                <div className="px-3 py-2 text-[12px] text-ink-3">Loading graph…</div>
              ) : graph.commits.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-ink-3">No commits yet</div>
              ) : (
                <div className="relative" style={{ height: graph.commits.length * GRAPH_ROW_H }}>
                  <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={graph.laneCount * GRAPH_LANE_W + 4}
                    height={graph.commits.length * GRAPH_ROW_H}
                    aria-hidden="true"
                  >
                    {graph.edges.map((e, i) => (
                      <path
                        key={i}
                        d={curvePath(laneX(e.from), rowY(e.fromRow), laneX(e.to), rowY(e.toRow))}
                        stroke={laneColor(e.from)}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        fill="none"
                        opacity={0.55}
                      />
                    ))}
                    {graph.commits.map((c, i) => (
                      <circle key={c.hash} cx={laneX(graph.lanes[i] ?? 0)} cy={rowY(i)} r={3.4} fill={laneColor(graph.lanes[i] ?? 0)} stroke="#0b0c0f" strokeWidth={1} />
                    ))}
                  </svg>
                  <ul aria-label="Commits">
                    {graph.commits.map((c) => (
                      <li
                        key={c.hash}
                        className="flex items-center gap-1.5 rounded-md pr-2 hover:bg-surface-2"
                        style={{ height: GRAPH_ROW_H, paddingLeft: graph.laneCount * GRAPH_LANE_W + 10 }}
                        title={`${c.hash} · ${c.author}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{c.subject}</span>
                        {c.refs.map((r) => (
                          <span
                            key={r}
                            className={`shrink-0 rounded-full border px-1.5 font-mono text-[10px] leading-4 ${
                              r.includes("HEAD") ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-ink-3"
                            }`}
                          >
                            {r}
                          </span>
                        ))}
                        <span className="shrink-0 text-[11px] text-ink-3">{c.relTime}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-line p-2.5">
            <button className="ring-pill !h-8 !px-3 !text-[12px]" style={{ ["--ring-a" as string]: "#56d8c9", ["--ring-b" as string]: "#8ea2ff" }} disabled={working} onClick={() => void run("pull")}>
              {busy === "pull" ? "Pulling…" : `Pull${st.behind ? ` ${st.behind}` : ""}`}
            </button>
            <button className="ring-pill !h-8 !px-3 !text-[12px]" style={{ ["--ring-a" as string]: "#ff8a5c", ["--ring-b" as string]: "#f2d45a" }} disabled={working} onClick={() => void run("push")}>
              {busy === "push" ? "Pushing…" : `Push${st.ahead ? ` ${st.ahead}` : ""}`}
            </button>
            {note && (
              <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-ink-3" title={note}>
                {note}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

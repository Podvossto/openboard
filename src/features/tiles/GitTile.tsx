import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import type { GitAction, GitStatus, Tile, TileData } from "../../lib/types";
import { changeBadge } from "./logic";

const TONE = {
  add: "text-ok",
  mod: "text-warn",
  del: "text-danger",
  conf: "text-danger",
  new: "text-info",
} as const;

/** Live git card: branch, ahead/behind, changes, recent commits; pull / push / commit-all. */
export function GitTile({ tile, setData }: { tile: Tile<"git">; setData: (d: TileData["git"]) => void }) {
  const cwd = tile.data.cwd ?? "";
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const [st, setSt] = useState<GitStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<GitAction | "refresh" | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState<string | null>(null);

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
    void refresh();
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const run = async (action: GitAction) => {
    if (busy && busy !== "refresh") return;
    setBusy(action);
    setNote(null);
    try {
      const out = await ipc.gitRun(cwd, action, msg);
      if (action === "commitAll") setMsg("");
      setNote(out.trim().split("\n").slice(-1)[0] || `${action} done`);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, defaultPath: cwd || resolvedCwd || undefined });
    if (typeof dir === "string") setData({ cwd: dir });
  };

  const folderLabel = (cwd || resolvedCwd || "default folder").split(/[\\/]/).filter(Boolean).slice(-2).join("/");

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
          <div className="flex items-center gap-2 px-3 pt-3">
            <span className="flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 font-mono text-[12px] font-semibold text-ink" title={st.upstream ?? "no upstream"}>
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
            <span className="text-[11.5px] text-ink-3">{st.changes.length} changed</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {st.changes.length > 0 && (
              <ul aria-label="Changes" className="mb-2">
                {st.changes.slice(0, 50).map((c) => {
                  const b = changeBadge(c.code);
                  return (
                    <li key={c.code + c.path} className="flex items-center gap-2 rounded-md px-1.5 py-0.5 font-mono text-[12px] hover:bg-surface-2">
                      <span className={`w-3 text-center font-bold ${TONE[b.tone]}`}>{b.label}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2" title={c.path}>
                        {c.path}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="px-1.5 pb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Recent commits</div>
            <ul aria-label="Commits">
              {st.commits.length === 0 && <li className="px-1.5 text-[12px] text-ink-3">No commits yet</li>}
              {st.commits.map((c) => (
                <li key={c.hash} className="flex items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
                  <span className="font-mono text-[11.5px] text-accent">{c.hash}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{c.subject}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{c.when}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2 border-t border-line p-2.5">
            <div className="flex gap-2">
              <input
                aria-label="Commit message"
                className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-bg/70 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70"
                placeholder="Commit message"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && msg.trim() && st.changes.length && void run("commitAll")}
              />
              <button
                className="h-9 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-bg transition hover:bg-white active:scale-95 disabled:opacity-40"
                disabled={!msg.trim() || st.changes.length === 0 || !!(busy && busy !== "refresh")}
                onClick={() => void run("commitAll")}
              >
                {busy === "commitAll" ? "Committing…" : "Commit all"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button className="ring-pill !h-8 !px-3 !text-[12px]" style={{ ["--ring-a" as string]: "#56d8c9", ["--ring-b" as string]: "#8ea2ff" }} disabled={!!(busy && busy !== "refresh")} onClick={() => void run("pull")}>
                {busy === "pull" ? "Pulling…" : `Pull${st.behind ? ` ${st.behind}` : ""}`}
              </button>
              <button className="ring-pill !h-8 !px-3 !text-[12px]" style={{ ["--ring-a" as string]: "#ff8a5c", ["--ring-b" as string]: "#f2d45a" }} disabled={!!(busy && busy !== "refresh")} onClick={() => void run("push")}>
                {busy === "push" ? "Pushing…" : `Push${st.ahead ? ` ${st.ahead}` : ""}`}
              </button>
              {note && (
                <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-ink-3" title={note}>
                  {note}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

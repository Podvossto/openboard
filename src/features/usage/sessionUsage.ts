// Per-console token usage. One light poller for every running Claude console that has a
// known agentSession id (Codex / unknown sessions are never shown — no fake numbers).
import { useEffect } from "react";
import { create } from "zustand";
import { ipc } from "../../lib/ipc";
import type { SessionUsage } from "../../lib/types";
import { useBoard } from "../../store/board";

export const SESSION_USAGE_POLL_MS = 60_000;

interface SessionUsageState {
  /** claude session id → usage */
  bySession: Record<string, SessionUsage>;
  refresh: (ids?: string[]) => Promise<void>;
}

/** Session ids of consoles that are running now (all workspaces). */
export function runningSessionIds(): string[] {
  const { board, runtime } = useBoard.getState();
  const ids = new Set<string>();
  for (const w of board.workspaces)
    for (const c of w.consoles)
      if (c.agent.kind === "claudeCode" && c.agentSession && runtime[c.id]?.running) ids.add(c.agentSession);
  return [...ids];
}

export const useSessionUsage = create<SessionUsageState>((set) => ({
  bySession: {},
  refresh: async (ids = runningSessionIds()) => {
    if (ids.length === 0) return;
    try {
      const r = await ipc.usageForSessions(ids);
      set((s) => ({ bySession: { ...s.bySession, ...r } }));
    } catch {
      /* keep the last known numbers */
    }
  },
}));

/** Mount once (App). Polls every 60s while at least one Claude console runs. */
export function useSessionUsagePoller() {
  useEffect(() => {
    const tick = () => void useSessionUsage.getState().refresh();
    // also refresh right when a new Claude session starts running
    let known = "";
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsub = useBoard.subscribe(() => {
      const key = runningSessionIds().sort().join(",");
      if (key === known) return;
      known = key;
      clearTimeout(debounce);
      if (key) debounce = setTimeout(tick, 800);
    });
    const t = setInterval(tick, SESSION_USAGE_POLL_MS);
    return () => {
      unsub();
      clearTimeout(debounce);
      clearInterval(t);
    };
  }, []);
}

/** Usage of one console, or null when unknown. */
export function useConsoleUsage(agentSession: string | undefined, kind: string): SessionUsage | null {
  return useSessionUsage((s) => (kind === "claudeCode" && agentSession ? (s.bySession[agentSession] ?? null) : null));
}

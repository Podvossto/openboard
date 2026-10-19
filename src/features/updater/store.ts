// Updater state: the app checks on start + every 6h, asks before installing, and keeps a
// small top-bar button when the user picks "Later".
import { useEffect } from "react";
import { create } from "zustand";
import { events, ipc } from "../../lib/ipc";
import type { UpdateInfo } from "../../lib/types";
import { AUTO_CHECK_DELAY_MS, AUTO_CHECK_EVERY_MS, shouldPrompt, type UpdatePhase } from "./logic";

interface UpdaterState {
  phase: UpdatePhase;
  current: string | null;
  info: UpdateInfo | null;
  error: string | null;
  /** dialog visible */
  promptOpen: boolean;
  /** version the user said "Later" to (this session) */
  deferred: string | null;
  downloaded: number;
  total: number | null;
  check: (manual: boolean) => Promise<void>;
  later: () => void;
  openPrompt: () => void;
  install: () => Promise<void>;
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  phase: "idle",
  current: null,
  info: null,
  error: null,
  promptOpen: false,
  deferred: null,
  downloaded: 0,
  total: null,

  check: async (manual) => {
    const busy = get().phase;
    if (busy === "checking" || busy === "downloading" || busy === "installing") return;
    set({ phase: "checking", error: null });
    try {
      const info = await ipc.updateCheck();
      if (!info) {
        set({ phase: "upToDate", info: null });
        return;
      }
      set({ phase: "available", info, promptOpen: get().promptOpen || shouldPrompt(info.version, get().deferred, manual) });
    } catch (e) {
      // background checks fail quietly (offline / private network down); manual ones show the reason
      set({ phase: manual ? "error" : get().info ? "available" : "idle", error: String(e) });
    }
  },

  later: () => set((s) => ({ promptOpen: false, deferred: s.info?.version ?? s.deferred })),
  openPrompt: () => set({ promptOpen: true }),

  install: async () => {
    if (!get().info) return;
    set({ phase: "downloading", downloaded: 0, total: null, error: null });
    const un = await events.onUpdateProgress((p) =>
      set({ downloaded: p.downloaded, total: p.total, phase: p.total != null && p.downloaded >= p.total ? "installing" : "downloading" }),
    );
    try {
      await ipc.updateInstall(); // restarts the app on success
      set({ phase: "installing" });
    } catch (e) {
      set({ phase: "error", error: String(e), promptOpen: true });
    } finally {
      un();
    }
  },
}));

/** Mount once (App): version + first check shortly after start, then every 6h. */
export function useUpdaterBoot() {
  useEffect(() => {
    void ipc
      .appVersion()
      .then((v) => useUpdater.setState({ current: v }))
      .catch(() => undefined);
    const first = setTimeout(() => void useUpdater.getState().check(false), AUTO_CHECK_DELAY_MS);
    const every = setInterval(() => void useUpdater.getState().check(false), AUTO_CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
}

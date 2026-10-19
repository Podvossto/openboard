// Update prompt (asks before installing) + the small top-bar button left behind by "Later".
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEffect } from "react";
import { fadeVariants, popVariants } from "../../lib/motion";
import { formatBytes, friendlyError, progressPct } from "./logic";
import { useUpdater } from "./store";

function Dialog() {
  const present = useIsPresent();
  const { info, current, phase, error, downloaded, total, later, install } = useUpdater();
  const busy = phase === "downloading" || phase === "installing";
  const pc = progressPct(downloaded, total);

  useEffect(() => {
    // capture phase: Esc closes only this dialog, not the sheet underneath it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      if (!/downloading|installing/.test(useUpdater.getState().phase)) useUpdater.getState().later();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <motion.div
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm ${present ? "" : "pointer-events-none"}`}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && later()}
    >
      <motion.div
        variants={popVariants}
        className="w-full max-w-[420px] rounded-2xl border border-line-strong bg-surface p-5 shadow-[0_32px_80px_-20px_rgb(0_0_0/0.9)]"
        role={present ? "dialog" : undefined}
        aria-modal={present ? "true" : undefined}
        aria-label={present ? "Update available" : undefined}
      >
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/15 text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="m-0 text-[15px] font-semibold text-ink">Agent Board {info?.version} is available</h3>
            <p className="m-0 mt-1 text-[13px] text-ink-2">
              You have {current ?? info?.currentVersion}. The update installs in place — your boards, settings and accounts stay as they are. Running consoles will stop and the app restarts.
            </p>
            {info?.notes && <p className="m-0 mt-2 max-h-28 overflow-y-auto whitespace-pre-line rounded-lg bg-surface-2 p-2 text-[12px] text-ink-2" data-testid="update-notes">{info.notes}</p>}
          </div>
        </div>

        {busy && (
          <div className="mt-4" data-testid="update-progress">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <i className="block h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pc ?? 30}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-ink-3">
              {phase === "installing" ? "Installing — restarting…" : `Downloading ${formatBytes(downloaded)}${total ? ` of ${formatBytes(total)}` : ""}`}
            </div>
          </div>
        )}
        {phase === "error" && error && <p className="m-0 mt-3 text-[12px] text-danger" role="alert">Update failed: {friendlyError(error)}</p>}

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            className="h-8 rounded-full border border-line bg-surface-2 px-4 text-[12.5px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-40"
            onClick={later}
          >
            Later
          </button>
          <button
            type="button"
            disabled={busy}
            autoFocus
            className="h-8 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-bg shadow-[0_0_16px_-4px_var(--color-accent)] transition hover:brightness-110 disabled:opacity-60"
            onClick={() => void install()}
          >
            {phase === "error" ? "Try again" : "Update now"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function UpdatePrompt() {
  const open = useUpdater((s) => s.promptOpen && !!s.info);
  return <AnimatePresence>{open && <Dialog key="update" />}</AnimatePresence>;
}

/** Shown after "Later": a small button to install whenever it suits. */
export function UpdateButton() {
  const show = useUpdater((s) => !!s.info && !s.promptOpen);
  const version = useUpdater((s) => s.info?.version);
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="update-btn"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="flex h-7 items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 px-2.5 text-[11.5px] font-semibold text-accent transition hover:bg-accent/20 active:scale-95"
          title={`Agent Board ${version} is available — click to update`}
          aria-label={`Update to ${version}`}
          onClick={() => useUpdater.getState().openPrompt()}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          Update
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** Settings › General block: version + manual check. */
export function UpdateSettings() {
  const { current, phase, info, error, check, openPrompt } = useUpdater();
  return (
    <div className="flex items-center gap-3" data-testid="update-settings">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">
          Version <span className="font-mono" data-testid="app-version">{current ?? "—"}</span>
        </div>
        <div className="text-[11.5px] text-ink-3" role="status" data-testid="update-status">
          {phase === "error" ? `Couldn't check for updates: ${friendlyError(error)}` : phase === "upToDate" ? "You're on the latest version." : phase === "checking" ? "Checking for updates…" : info ? `Version ${info.version} is available.` : "Updates are checked on start and every 6 hours."}
        </div>
      </div>
      {info && phase !== "checking" ? (
        <button className="btn sm" onClick={openPrompt}>
          Update to {info.version}
        </button>
      ) : (
        <button className="btn sm" disabled={phase === "checking"} onClick={() => void check(true)}>
          Check for updates
        </button>
      )}
    </div>
  );
}

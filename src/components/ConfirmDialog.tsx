import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { popVariants, fadeVariants } from "../lib/motion";
import { useDialogStore } from "../lib/dialog";

export function ConfirmDialog() {
  const dialog = useDialogStore((s) => s.dialog);
  const respond = useDialogStore((s) => s.respond);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        respond(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [dialog, respond]);

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          variants={fadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) respond(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
        >
          <motion.div
            variants={popVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full max-w-[420px] rounded-2xl border border-line-strong bg-surface p-5 shadow-[0_32px_80px_-20px_rgb(0_0_0/0.9)]"
          >
            <div className="flex items-start gap-3.5">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                  dialog.kind === "danger"
                    ? "bg-danger/15 text-danger border border-danger/30"
                    : dialog.kind === "info"
                      ? "bg-info/15 text-info border border-info/30"
                      : "bg-warn/15 text-warn border border-warn/30"
                }`}
              >
                {dialog.kind === "danger" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : dialog.kind === "info" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
              </span>
              <div className="flex-1 min-w-0 pt-0.5">
                {dialog.title && (
                  <h3 id="confirm-dialog-title" className="text-[15px] font-semibold text-ink">
                    {dialog.title}
                  </h3>
                )}
                <p id="confirm-dialog-desc" className="mt-1 text-[13px] leading-relaxed text-ink-2 whitespace-pre-line">
                  {dialog.message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                className="h-8 rounded-full border border-line bg-surface-2 px-4 text-[12.5px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95"
                onClick={() => respond(false)}
              >
                {dialog.cancelText ?? "Cancel"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className={`h-8 rounded-full px-4 text-[12.5px] font-semibold transition active:scale-95 ${
                  dialog.kind === "danger"
                    ? "bg-danger text-white hover:brightness-110 shadow-[0_0_16px_-4px_var(--color-danger)]"
                    : dialog.kind === "info"
                      ? "bg-info text-white hover:brightness-110 shadow-[0_0_16px_-4px_var(--color-info)]"
                      : "bg-warn text-bg hover:brightness-110 shadow-[0_0_16px_-4px_var(--color-warn)]"
                }`}
                onClick={() => respond(true)}
              >
                {dialog.confirmText ?? "Confirm"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

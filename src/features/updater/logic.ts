// Pure helpers for the in-app updater (unit-tested; no React / IPC).

export const AUTO_CHECK_DELAY_MS = 5_000;
export const AUTO_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "installing" | "error";

/** 0–100 or null when the server sent no Content-Length. */
export function progressPct(downloaded: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
}

/** 1_572_864 → "1.5 MB" */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * The startup / periodic check opens the dialog only for a version the user has not
 * already deferred this session ("Later" keeps the small top-bar button instead).
 */
export function shouldPrompt(version: string, deferred: string | null, manual: boolean): boolean {
  return manual || version !== deferred;
}

/** Short status line for Settings › General. */
export function statusLine(phase: UpdatePhase, version: string | null, error: string | null): string {
  switch (phase) {
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return "You're on the latest version.";
    case "available":
      return `Version ${version ?? "?"} is available.`;
    case "downloading":
      return `Downloading ${version ?? "update"}…`;
    case "installing":
      return "Installing — the app will restart.";
    case "error":
      return `Couldn't check for updates: ${friendlyError(error)}`;
    default:
      return "";
  }
}

/** Network failures from the updater are long; keep the gist. */
export function friendlyError(e: string | null): string {
  if (!e) return "unknown error";
  const s = e.replace(/^update:\s*/i, "");
  if (/error sending request|connection refused|timed out|dns|network/i.test(s)) return "update server not reachable (is private network connected?)";
  if (/signature/i.test(s)) return "the downloaded update failed signature verification";
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

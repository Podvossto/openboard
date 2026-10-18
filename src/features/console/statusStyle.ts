import type { Status } from "../../lib/types";

export const STATUS_COLOR: Record<Status, string> = {
  starting: "var(--text-3)",
  working: "var(--info)",
  resting: "var(--ok)",
  needsYou: "var(--warn)",
  exited: "var(--text-3)",
};

export const STATUS_LABEL: Record<Status, string> = {
  starting: "starting",
  working: "working",
  resting: "resting",
  needsYou: "needs you",
  exited: "stopped",
};

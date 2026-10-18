import type { Status } from "../../lib/types";

/** Literal colours (motion can only interpolate real colours, not CSS vars). */
export const STATUS_COLOR: Record<Status, string> = {
  starting: "#8b8d99",
  working: "#6aa8ff",
  resting: "#4fd1a1",
  needsYou: "#ffb547",
  exited: "#6a6c78",
};

export const STATUS_LABEL: Record<Status, string> = {
  starting: "starting",
  working: "working",
  resting: "ready",
  needsYou: "needs you",
  exited: "stopped",
};

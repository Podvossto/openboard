import type { Status } from "../../lib/types";

export const STATUS_COLOR: Record<Status, string> = {
  starting: "#8b93a7",
  working: "#4f8cff",
  resting: "#3fb68b",
  needsYou: "#f5a524",
  exited: "#5b6273",
};

export const STATUS_LABEL: Record<Status, string> = {
  starting: "starting",
  working: "working",
  resting: "resting",
  needsYou: "needs you",
  exited: "stopped",
};

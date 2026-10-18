// Pure loop scheduling decisions (unit-tested). The runner (useLoops) feeds it facts.
import type { LoopConfig, Status } from "../../lib/types";

export const DEFAULT_LOOP: LoopConfig = {
  enabled: false,
  trigger: { kind: "idle", seconds: 60 },
  message: "continue",
  maxRuns: 10,
  goal: "",
  runs: 0,
};

/** Never fire more often than this, whatever the trigger says. */
export const MIN_GAP_MS = 15_000;

export interface LoopFacts {
  now: number;
  status: Status;
  running: boolean;
  /** when the console last became "resting" (ms), if it is resting */
  restingSince?: number;
  /** output received since the last check (ANSI-stripped) */
  newOutput: string;
}

export type Decision = { fire: false; reason?: string } | { fire: true; why: string };

export function decide(cfg: LoopConfig, f: LoopFacts): Decision {
  if (!cfg.enabled) return { fire: false };
  if (!f.running) return { fire: false, reason: "console stopped" };
  if (cfg.maxRuns > 0 && cfg.runs >= cfg.maxRuns) return { fire: false, reason: "max runs reached" };
  if (!cfg.message.trim()) return { fire: false, reason: "no message" };
  // never interrupt an agent mid-turn or while it waits for the human
  if (f.status === "working" || f.status === "needsYou" || f.status === "starting") return { fire: false };
  if (cfg.lastRunAt && f.now - cfg.lastRunAt < MIN_GAP_MS) return { fire: false };
  const t = cfg.trigger;
  switch (t.kind) {
    case "interval": {
      const due = (cfg.lastRunAt ?? 0) + Math.max(1, t.minutes) * 60_000;
      return f.now >= due ? { fire: true, why: `every ${t.minutes} min` } : { fire: false };
    }
    case "idle":
      return f.restingSince !== undefined && f.now - f.restingSince >= Math.max(5, t.seconds) * 1000
        ? { fire: true, why: `idle ${t.seconds}s` }
        : { fire: false };
    case "output":
      return t.match.trim() && f.newOutput.toLowerCase().includes(t.match.trim().toLowerCase())
        ? { fire: true, why: `saw “${t.match.trim()}”` }
        : { fire: false };
  }
}

export function describeTrigger(t: LoopConfig["trigger"]): string {
  switch (t.kind) {
    case "interval":
      return `every ${t.minutes} min`;
    case "idle":
      return `after ${t.seconds}s idle`;
    case "output":
      return `when output has “${t.match}”`;
  }
}

// Registry so the node's "…" menu can drive the TerminalView (which owns cols/rows + xterm).
export interface TerminalControl {
  /** kill (if running) and start; resume=true continues the last agent session */
  start: (resume: boolean) => Promise<void>;
}

export const terminalControls = new Map<string, TerminalControl>();

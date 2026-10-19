// Shared console launch path: the per-console Start/Resume buttons (TerminalView),
// the Dock's "Resume all" and the app-start auto-resume all end up here.
import { ipc } from "../../lib/ipc";
import { activeWorkspace, useBoard } from "../../store/board";

import { canResume } from "./helpers";

/** (kind, title) of the agent-linkable tiles this console is linked to (passed to spawn). */
function linkedTiles(node: { links?: string[] }): [string, string][] {
  const tiles = useBoard.getState().board.workspaces.flatMap((w) => w.tiles ?? []);
  return (node.links ?? [])
    .map((id) => tiles.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t && ["kanban", "checklist", "calendar"].includes(t.kind))
    .map((t) => [t.kind, t.title]);
}

/** Consoles with a launch in flight — guards double-starts from overlay, dock and menus. */
export const launchInflight = new Set<string>();

/** Last known terminal grid per console (kept fresh by TerminalView) so launches
 *  that have no live terminal — Dock resume-all — reuse the user's chosen size. */
export const terminalSizes = new Map<string, { cols: number; rows: number }>();

export interface LaunchOptions {
  cols?: number;
  rows?: number;
  /** runs just before spawn — the view fits and resets its terminal here */
  prepare?: () => void;
}

/** Kill (if running) and (re)spawn console `id`. Fresh Claude starts get a new session
 *  id; resume keeps the stored one. Returns false when a launch is already in flight. */
export async function launchConsole(id: string, resume: boolean, opts: LaunchOptions = {}): Promise<boolean> {
  if (launchInflight.has(id)) return false;
  launchInflight.add(id);
  const st = useBoard.getState();
  try {
    if (st.runtime[id]?.running) {
      await ipc.kill(id).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 150));
    }
    const node = st.board.workspaces.flatMap((w) => w.consoles).find((c) => c.id === id);
    if (!node) throw new Error(`console ${id} no longer exists`);
    let agentSession = node.agentSession;
    if (node.agent.kind === "claudeCode" && !resume) {
      agentSession = await ipc.newId();
      st.patchConsole(id, { agentSession });
    }
    if (opts.cols && opts.rows) terminalSizes.set(id, { cols: opts.cols, rows: opts.rows });
    const size = terminalSizes.get(id);
    opts.prepare?.();
    st.setRuntime(id, { status: "starting", exitCode: undefined });
    await ipc.spawn({
      id,
      agent: node.agent,
      cwd: node.cwd,
      cols: opts.cols ?? size?.cols ?? 80,
      rows: opts.rows ?? size?.rows ?? 24,
      agentSession,
      resume,
      profile: node.profile,
      lead: node.lead,
      model: node.model,
      links: linkedTiles(node),
    });
    // PTY is up; mounted TerminalViews attach themselves when they notice
    st.setRuntime(id, { running: true });
    return true;
  } finally {
    launchInflight.delete(id);
  }
}

/** Stopped consoles in the active workspace that have something to resume. */
export function resumableConsoles() {
  const st = useBoard.getState();
  return activeWorkspace(st.board).consoles.filter((c) => !st.runtime[c.id]?.running && canResume(c));
}

/** Relaunch every resumable stopped console, staggered so the CLIs don't all boot at once. */
export async function resumeAll(staggerMs = 250): Promise<number> {
  let started = 0;
  for (const c of resumableConsoles()) {
    if (started) await new Promise((r) => setTimeout(r, staggerMs));
    try {
      if (await launchConsole(c.id, true)) started++;
    } catch {
      /* one failure must not stop the others */
    }
  }
  return started;
}

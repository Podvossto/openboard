// Console → tile links (user-made by dragging from a console's right knob onto a tile).
import { ask } from "../../lib/dialog";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import { terminalControls } from "../console/controls";
import { isLinkable, toggleLink } from "./tileOps";

const find = () => {
  const ws = useBoard.getState().board.workspaces;
  return {
    console: (id: string) => ws.flatMap((w) => w.consoles).find((c) => c.id === id),
    tile: (id: string) => ws.flatMap((w) => w.tiles ?? []).find((t) => t.id === id),
  };
};

/**
 * Valid drops (source must be a Claude Code console — it gets the MCP tools):
 * - onto a kanban/checklist/calendar tile → tile tools
 * - onto another console → the source becomes a lead and that console joins its team
 */
export function linkValid(source: string | null, target: string | null): boolean {
  if (!source || !target || source === target) return false;
  const f = find();
  const c = f.console(source);
  if (!c || c.agent.kind !== "claudeCode" || (c.links ?? []).includes(target)) return false;
  const t = f.tile(target);
  if (t) return isLinkable(t.kind);
  return !!f.console(target);
}

/** Tools are fixed at launch: offer a restart when the console is running. */
async function offerRestart(id: string, title: string, what: string) {
  if (!useBoard.getState().runtime[id]?.running) return;
  const yes = await ask(`${what}\nRestart "${title}" now so the agent gets the change? (It resumes the same session.)`, {
    title: "Restart agent",
    kind: "info",
    confirmText: "Restart",
    cancelText: "Later",
  }).catch(() => false);
  if (!yes) return;
  await ipc.kill(id).catch(() => undefined);
  await terminalControls.get(id)?.start(true);
}

export async function linkConsole(source: string | null, target: string | null) {
  if (!linkValid(source, target)) return;
  const f = find();
  const c = f.console(source!)!;
  const t = f.tile(target!);
  if (t) {
    useBoard.getState().patchConsole(c.id, { links: toggleLink(c.links, t.id) });
    await offerRestart(c.id, c.title, `Linked ${t.kind} "${t.title}" to "${c.title}".`);
    return;
  }
  const w = f.console(target!)!;
  const wasLead = !!c.lead;
  useBoard.getState().patchConsole(c.id, { links: toggleLink(c.links, w.id), lead: true });
  // a fresh lead needs a restart to get its console tools; an existing lead sees the new
  // teammate right away (list_consoles reads the live roster)
  if (!wasLead) await offerRestart(c.id, c.title, `"${c.title}" is now the lead of "${w.title}".`);
}

export async function unlinkConsole(source: string, target: string) {
  const f = find();
  const c = f.console(source);
  const t = f.tile(target);
  if (!c || !(c.links ?? []).includes(target)) return;
  const w = f.console(target);
  const what = t ? `${t.kind} "${t.title}"` : w ? `teammate "${w.title}"` : "this tile";
  const ok = await ask(`Unlink ${what} from "${c.title}"?`, { title: "Unlink tile", kind: "warning", confirmText: "Unlink" }).catch(() => false);
  if (!ok) return;
  useBoard.getState().patchConsole(c.id, { links: toggleLink(c.links, target) });
  if (t) await offerRestart(c.id, c.title, "Unlinked.");
}

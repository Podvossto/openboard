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

/** Only console → kanban/checklist/calendar, and only Claude Code consoles (they get MCP). */
export function linkValid(source: string | null, target: string | null): boolean {
  if (!source || !target) return false;
  const f = find();
  const c = f.console(source);
  const t = f.tile(target);
  return !!c && !!t && isLinkable(t.kind) && c.agent.kind === "claudeCode" && !(c.links ?? []).includes(t.id);
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
  const t = f.tile(target!)!;
  useBoard.getState().patchConsole(c.id, { links: toggleLink(c.links, t.id) });
  await offerRestart(c.id, c.title, `Linked ${t.kind} "${t.title}" to "${c.title}".`);
}

export async function unlinkConsole(source: string, target: string) {
  const f = find();
  const c = f.console(source);
  const t = f.tile(target);
  if (!c || !(c.links ?? []).includes(target)) return;
  const ok = await ask(`Unlink ${t ? `${t.kind} "${t.title}"` : "this tile"} from "${c.title}"?`, { title: "Unlink tile", kind: "warning", confirmText: "Unlink" }).catch(() => false);
  if (!ok) return;
  useBoard.getState().patchConsole(c.id, { links: toggleLink(c.links, target) });
  await offerRestart(c.id, c.title, "Unlinked.");
}

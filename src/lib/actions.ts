// CONTRACT: shared high-level actions. Features call these instead of re-implementing.
import { ipc } from "./ipc";
import type { AgentKind, ConsoleNode } from "./types";
import {
  activeWorkspace,
  agentShort,
  boardBottom,
  CONSOLE_H,
  CONSOLE_W,
  GROUP_COLORS,
  groupLayout,
  nextPosition,
  useBoard,
} from "../store/board";

/** Create one console in the active workspace using Settings defaults. Returns its id.
 *  The TerminalView auto-starts consoles whose id is in `autoStart`. */
export async function createConsole(agent?: AgentKind, opts: { title?: string; cwd?: string } = {}) {
  const st = useBoard.getState();
  const a = agent ?? st.settings.defaultAgent;
  const ws = activeWorkspace(st.board);
  const id = await ipc.newId();
  const n = ws.consoles.filter((c) => agentShort(c.agent) === agentShort(a)).length + 1;
  const node: ConsoleNode = {
    id,
    title: opts.title ?? `${agentShort(a)}-${n}`,
    agent: a,
    cwd: opts.cwd ?? "",
    ...nextPosition(ws.consoles),
    width: CONSOLE_W,
    height: CONSOLE_H,
  };
  autoStart.add(id);
  st.addConsoles([node]);
  return id;
}

/** Spawn several consoles inside a new group below everything else. */
export async function spawnGroup(name: string, members: { title: string; agent: AgentKind; lead?: boolean }[], cwd = "") {
  const st = useBoard.getState();
  const ws = activeWorkspace(st.board);
  const gid = await ipc.newId();
  const { group, slots } = groupLayout(members.length, 0, boardBottom(ws));
  const ids = await Promise.all(members.map(() => ipc.newId()));
  st.addGroup({ id: gid, name, color: GROUP_COLORS[ws.groups.length % GROUP_COLORS.length]!, ...group });
  st.addConsoles(
    members.map((m, i) => ({
      id: ids[i]!,
      title: m.title,
      agent: m.agent,
      cwd,
      ...slots[i]!,
      width: CONSOLE_W,
      height: CONSOLE_H,
      group: gid,
      ...(m.lead ? { lead: true } : {}),
    })),
  );
  ids.forEach((id) => autoStart.add(id));
  return { groupId: gid, ids };
}

/** Consoles that should start immediately when their terminal mounts (fresh session). */
export const autoStart = new Set<string>();

export const DEFAULT_SIZE = { width: CONSOLE_W, height: CONSOLE_H };

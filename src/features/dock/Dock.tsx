import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { createConsole, spawnGroup } from "../../lib/actions";
import { ipc, submit } from "../../lib/ipc";
import type { AgentKind } from "../../lib/types";
import {
  activeWorkspace,
  boardBottom,
  GROUP_COLORS,
  useBoard,
} from "../../store/board";
import { emptyGroupFrame, planGroupFromConsoles } from "../board/grouping";
import { CommandBar } from "./CommandBar";
import { useDismiss } from "./useDismiss";
import "./dock.css";

type MenuName = "new" | "spawn" | "presets" | null;

const AGENTS: { label: string; agent: AgentKind }[] = [
  { label: "Claude Code", agent: { kind: "claudeCode" } },
  { label: "Codex", agent: { kind: "codex" } },
  { label: "Shell", agent: { kind: "custom", program: "" } },
];

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
};

export function Dock() {
  const rf = useReactFlow();
  const presets = useBoard((s) => s.board.presets);
  const [menu, setMenu] = useState<MenuName>(null);
  const [spawnN, setSpawnN] = useState(4);
  const [spawnAgent, setSpawnAgent] = useState(0);
  const [presetName, setPresetName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menu !== null, root, closeMenu);

  const say = useCallback((msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 3500);
  }, []);

  const fitTo = useCallback(
    (ids: string[]) => {
      // wait a frame so React Flow has the new nodes
      window.setTimeout(() => void rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.15, duration: 350, maxZoom: 1 }), 120);
    },
    [rf],
  );

  const newConsole = useCallback(
    async (agent?: AgentKind) => {
      setMenu(null);
      try {
        fitTo([await createConsole(agent)]);
      } catch (e) {
        say(`Could not create console: ${String(e)}`);
      }
    },
    [fitTo, say],
  );

  const spawn = async () => {
    setMenu(null);
    const agent = AGENTS[spawnAgent]!.agent;
    const members = Array.from({ length: spawnN }, (_, i) => ({ title: `${AGENTS[spawnAgent]!.label.split(" ")[0]!.toLowerCase()}-${i + 1}`, agent }));
    try {
      const { groupId } = await spawnGroup(`Team ${spawnN}`, members);
      fitTo([groupId]);
    } catch (e) {
      say(`Spawn failed: ${String(e)}`);
    }
  };

  const selectedConsoleIds = () =>
    rf.getNodes().filter((n) => n.selected && n.type === "console").map((n) => n.id);

  const groupSelected = useCallback(async () => {
    setMenu(null);
    const st = useBoard.getState();
    const ws = activeWorkspace(st.board);
    const sel = new Set(rf.getNodes().filter((n) => n.selected && n.type === "console").map((n) => n.id));
    const chosen = ws.consoles.filter((c) => sel.has(c.id));
    const id = await ipc.newId();
    const color = GROUP_COLORS[ws.groups.length % GROUP_COLORS.length]!;
    const name = `Group ${ws.groups.length + 1}`;
    const plan = planGroupFromConsoles(chosen, ws.groups);
    if (!plan) {
      st.addGroup({ id, name, color, ...emptyGroupFrame(0, boardBottom(ws)) });
      say("Created an empty group — use + in its header to add consoles.");
    } else {
      // group must exist before children point at it
      st.addGroup({ id, name, color, ...plan.group });
      for (const m of plan.moves) st.patchConsole(m.id, { group: id, x: m.x, y: m.y });
      say(`Grouped ${chosen.length} console${chosen.length === 1 ? "" : "s"}.`);
    }
    fitTo([id]);
  }, [rf, say, fitTo]);

  const running = () => {
    const st = useBoard.getState();
    return activeWorkspace(st.board).consoles.filter((c) => st.runtime[c.id]?.running);
  };

  const pauseAll = async () => {
    const list = running();
    if (!list.length) return say("No running consoles.");
    const ok = await ask(`Send Esc (interrupt) to ${list.length} running console${list.length === 1 ? "" : "s"}?`, {
      title: "Pause all",
      kind: "warning",
    });
    if (!ok) return;
    await Promise.all(list.map((c) => ipc.write(c.id, "\x1b").catch(() => undefined)));
    say(`Interrupted ${list.length} console${list.length === 1 ? "" : "s"}.`);
  };

  const resumeAll = async () => {
    const st = useBoard.getState();
    const list = running().filter((c) => st.runtime[c.id]?.status === "resting");
    if (!list.length) return say("Nothing resting to resume.");
    await Promise.all(list.map((c) => submit(c.id, "continue").catch(() => undefined)));
    say(`Sent “continue” to ${list.length} console${list.length === 1 ? "" : "s"}.`);
  };

  const spawnPreset = async (id: string) => {
    setMenu(null);
    const p = useBoard.getState().board.presets.find((x) => x.id === id);
    if (!p) return;
    const { groupId } = await spawnGroup(p.name, p.members);
    fitTo([groupId]);
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    const ws = activeWorkspace(useBoard.getState().board);
    const sel = new Set(selectedConsoleIds());
    const members = ws.consoles.filter((c) => sel.has(c.id)).map((c) => ({ title: c.title, agent: c.agent }));
    if (!members.length) return say("Select some consoles first.");
    useBoard.getState().savePreset({ id: await ipc.newId(), name, members });
    setPresetName("");
    setMenu(null);
    say(`Saved preset “${name}”.`);
  };

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void newConsole();
      } else if (k === "g") {
        e.preventDefault();
        void groupSelected();
      } else if (k === "m") {
        e.preventDefault();
        useBoard.getState().setUi({ memoryOpen: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newConsole, groupSelected]);

  const toggle = (m: Exclude<MenuName, null>) => setMenu((cur) => (cur === m ? null : m));

  return (
    <div className="dock" ref={root} role="toolbar" aria-label="Board dock">
      {note && <div className="dock-note" role="status">{note}</div>}
      <CommandBar />
      <div className="dock-row">
        <div className="split">
          <button className="btn primary" title="New console with the default agent (Ctrl+Shift+N)" onClick={() => void newConsole()}>
            + New <span className="kbd">Ctrl+Shift+N</span>
          </button>
          <button
            className="btn primary caret"
            title="Choose agent"
            aria-label="Choose agent"
            aria-haspopup="menu"
            aria-expanded={menu === "new"}
            onClick={() => toggle("new")}
          >
            ▾
          </button>
          {menu === "new" && (
            <div className="menu dock-menu" role="menu">
              {AGENTS.map((a) => (
                <button key={a.label} className="menu-item" role="menuitem" onClick={() => void newConsole(a.agent)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="split">
          <button className="btn" title="Spawn a group of N consoles" onClick={() => void spawn()}>
            Spawn {spawnN}
          </button>
          <button
            className="btn caret"
            title="Spawn options"
            aria-label="Spawn options"
            aria-haspopup="menu"
            aria-expanded={menu === "spawn"}
            onClick={() => toggle("spawn")}
          >
            ▾
          </button>
          {menu === "spawn" && (
            <div className="menu dock-menu spawn-menu" role="menu">
              <div className="menu-label">Consoles</div>
              <div className="stepper">
                <button className="btn icon sm" aria-label="Fewer" disabled={spawnN <= 2} onClick={() => setSpawnN((n) => Math.max(2, n - 1))}>−</button>
                <span className="stepper-val" aria-live="polite">{spawnN}</span>
                <button className="btn icon sm" aria-label="More" disabled={spawnN >= 8} onClick={() => setSpawnN((n) => Math.min(8, n + 1))}>+</button>
              </div>
              <div className="menu-label">Agent</div>
              <select className="input" value={spawnAgent} onChange={(e) => setSpawnAgent(Number(e.target.value))}>
                {AGENTS.map((a, i) => (
                  <option key={a.label} value={i}>{a.label}</option>
                ))}
              </select>
              <button className="btn primary spawn-go" onClick={() => void spawn()}>Spawn {spawnN}</button>
            </div>
          )}
        </div>

        <button className="btn" title="Group selected consoles, or create an empty group (Ctrl+Shift+G)" onClick={() => void groupSelected()}>
          Group
        </button>

        <div className="split">
          <button
            className="btn"
            title="Spawn a preset or save the selection as one"
            aria-haspopup="menu"
            aria-expanded={menu === "presets"}
            onClick={() => toggle("presets")}
          >
            Presets ▾
          </button>
          {menu === "presets" && (
            <div className="menu dock-menu" role="menu">
              {presets.length === 0 && <div className="menu-label">No presets yet</div>}
              {presets.map((p) => (
                <div key={p.id} className="preset-row">
                  <button className="menu-item" role="menuitem" onClick={() => void spawnPreset(p.id)}>
                    {p.name}
                    <span className="hint">{p.members.length}</span>
                  </button>
                  <button
                    className="btn ghost sm icon preset-del"
                    title={`Delete preset ${p.name}`}
                    aria-label={`Delete preset ${p.name}`}
                    onClick={() => useBoard.getState().removePreset(p.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="menu-sep" />
              <div className="menu-label">Save selection as preset</div>
              <form
                className="preset-save"
                onSubmit={(e) => {
                  e.preventDefault();
                  void savePreset();
                }}
              >
                <input className="input" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                <button className="btn sm" type="submit" disabled={!presetName.trim()}>Save</button>
              </form>
            </div>
          )}
        </div>

        <span className="dock-sep" />
        <button className="btn" title="Send Esc to every running console" onClick={() => void pauseAll()}>
          ⏸ Pause all
        </button>
        <button className="btn" title="Send “continue” to resting consoles" onClick={() => void resumeAll()}>
          ▶ Resume all
        </button>
        <span className="dock-sep" />
        <button className="btn" title="Workspace memory (Ctrl+Shift+M)" onClick={() => useBoard.getState().setUi({ memoryOpen: true })}>
          Memory
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { createConsole, spawnGroup } from "../../lib/actions";
import { ipc, submit } from "../../lib/ipc";
import type { CatalogStatus, AgentKind } from "../../lib/types";
import {
  activeWorkspace,
  boardBottom,
  GROUP_COLORS,
  useBoard,
} from "../../store/board";
import { emptyGroupFrame, planGroupFromConsoles } from "../board/grouping";
import { CommandBar } from "./CommandBar";
import { AgentIcon, CatalogIcon } from "../../components/AgentIcon";
import { AnimatePresence, motion } from "motion/react";
import { popVariants } from "../../lib/motion";
import { useDismiss } from "./useDismiss";
import { ComposeGroup } from "./ComposeGroup";
import { resumableConsoles, resumeAll } from "../console/launch";

type MenuName = "new" | "compose" | "presets" | "resume" | null;

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

  const spawn = async (name: string, members: { title: string; agent: AgentKind; lead?: boolean }[]) => {
    setMenu(null);
    try {
      const { groupId } = await spawnGroup(name, members);
      fitTo([groupId]);
      say(`Spawned ${members.length} in “${name}”.`);
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

  /** Relaunch every stopped console that has a resumable session (staggered). */
  const resumeAllNow = async () => {
    setMenu(null);
    if (!resumableConsoles().length) return say("Nothing stopped to resume.");
    const n = await resumeAll();
    say(n ? `Resumed ${n} console${n === 1 ? "" : "s"}.` : "Resume failed.");
  };

  /** Old behaviour: type "continue" into running consoles that are resting. */
  const nudgeResting = async () => {
    setMenu(null);
    const st = useBoard.getState();
    const list = running().filter((c) => st.runtime[c.id]?.status === "resting");
    if (!list.length) return say("Nothing resting.");
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
      } else if (k === "e") {
        e.preventDefault();
        useBoard.getState().setUi({ codeOpen: true });
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
    <div
      ref={root}
      role="toolbar"
      aria-label="Board dock"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-6 pb-4 pt-10 [background:linear-gradient(to_top,rgb(10_11_13/0.85),rgb(10_11_13/0.5)_55%,transparent)]"
    >
      {/* popovers anchor above the pill row */}
      <div className="pointer-events-auto relative flex w-full max-w-[760px] flex-col items-center gap-3">
        {note && (
          <div role="status" className="glass animate-pop rounded-full px-4 py-1.5 text-[12px] text-ink">
            {note}
          </div>
        )}

        <AnimatePresence>
          {menu === "compose" && (
            <motion.div
              key="compose"
              variants={popVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ transformOrigin: "bottom center" }}
              className="absolute bottom-[calc(100%+12px)] right-0"
            >
              <ComposeGroup onBack={() => setMenu(null)} onSpawn={(n, m) => void spawn(n, m)} />
            </motion.div>
          )}
        </AnimatePresence>

        <HintChip />

        <div className="dock-row flex flex-wrap items-center justify-center gap-2">
          <div className="relative">
            <button
              className="ring-pill"
              style={{ ["--ring-a" as string]: "#56d8c9", ["--ring-b" as string]: "#8ea2ff" }}
              title="New console with the default agent (Ctrl+Shift+N) · right-click to choose agent"
              onClick={() => void newConsole()}
              onContextMenu={(e) => {
                e.preventDefault();
                toggle("new");
              }}
              aria-expanded={menu === "new"}
            >
              New console
            </button>
            {menu === "new" && (
              <PopMenu>
                {AGENTS.map((a) => (
                  <PopItem key={a.label} onClick={() => void newConsole(a.agent)}>
                    <AgentIcon agent={a.agent.kind} size={15} />
                    {a.label}
                  </PopItem>
                ))}
                <CatalogItems onPick={(program) => void newConsole({ kind: "custom", program })} />
              </PopMenu>
            )}
          </div>

          <button
            className="ring-pill"
            style={{ ["--ring-a" as string]: "#7bd389", ["--ring-b" as string]: "#56d8c9" }}
            title="Compose and spawn a group of agents"
            aria-expanded={menu === "compose"}
            onClick={() => toggle("compose")}
          >
            Spawn 4
          </button>

          <button
            className="ring-pill"
            style={{ ["--ring-a" as string]: "#f2d45a", ["--ring-b" as string]: "#b6e35a" }}
            title="Group selected consoles, or create an empty group (Ctrl+Shift+G)"
            onClick={() => void groupSelected()}
          >
            Group
          </button>

          <div className="relative">
            <button
              className="ring-pill"
              style={{ ["--ring-a" as string]: "#f2a65a", ["--ring-b" as string]: "#f2d45a" }}
              title="Spawn a preset or save the selection as one"
              aria-expanded={menu === "presets"}
              onClick={() => toggle("presets")}
            >
              Presets
            </button>
            {menu === "presets" && (
              <PopMenu wide>
                {presets.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-ink-3">No presets yet</div>}
                {presets.map((p) => (
                  <div key={p.id} className="group/row flex items-center">
                    <PopItem onClick={() => void spawnPreset(p.id)}>
                      {p.name}
                      <span className="ml-auto text-[11px] text-ink-3">{p.members.length}</span>
                    </PopItem>
                    <button
                      className="ml-1 grid size-6 place-items-center rounded-md text-ink-3 opacity-0 transition group-hover/row:opacity-100 hover:bg-surface-3 hover:text-danger"
                      title={`Delete preset ${p.name}`}
                      aria-label={`Delete preset ${p.name}`}
                      onClick={() => useBoard.getState().removePreset(p.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="my-1.5 h-px bg-line" />
                <form
                  className="flex gap-1.5 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void savePreset();
                  }}
                >
                  <input
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg/60 px-2.5 text-[12px] outline-none focus:border-accent/70"
                    placeholder="Save selection as…"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                  <button className="h-8 rounded-lg bg-surface-3 px-3 text-[12px] font-semibold transition hover:bg-line-strong disabled:opacity-40" type="submit" disabled={!presetName.trim()}>
                    Save
                  </button>
                </form>
              </PopMenu>
            )}
          </div>

          <button
            className="ring-pill"
            style={{ ["--ring-a" as string]: "#ff6b8a", ["--ring-b" as string]: "#ff9b6b" }}
            title="Send Esc (interrupt) to every running console"
            onClick={() => void pauseAll()}
          >
            Pause all
          </button>
          <div className="relative">
            <button
              className="ring-pill"
              style={{ ["--ring-a" as string]: "#ff6b8a", ["--ring-b" as string]: "#b48cff" }}
              title="Relaunch stopped consoles that have a session to resume · right-click for more"
              aria-expanded={menu === "resume"}
              onClick={() => void resumeAllNow()}
              onContextMenu={(e) => {
                e.preventDefault();
                toggle("resume");
              }}
            >
              Resume all
            </button>
            {menu === "resume" && (
              <PopMenu>
                <PopItem onClick={() => void resumeAllNow()}>
                  <span className="text-ink-2">Resume all</span>
                  <span className="ml-auto text-[11px] text-ink-3">relaunch stopped</span>
                </PopItem>
                <PopItem onClick={() => void nudgeResting()}>
                  <span className="text-ink-2">Nudge resting (continue)</span>
                  <span className="ml-auto text-[11px] text-ink-3">typing “continue”</span>
                </PopItem>
              </PopMenu>
            )}
          </div>
          <button
            className="ring-pill"
            style={{ ["--ring-a" as string]: "#b48cff", ["--ring-b" as string]: "#8ea2ff" }}
            title="Workspace memory (Ctrl+Shift+M)"
            onClick={() => useBoard.getState().setUi({ memoryOpen: true })}
          >
            Memory
          </button>
        </div>

        <CommandBar />
      </div>
    </div>
  );
}

function PopMenu({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="menu" className={`glass animate-pop absolute bottom-[calc(100%+10px)] left-1/2 z-30 -translate-x-1/2 rounded-xl p-1.5 ${wide ? "w-64" : "w-48"}`}>
      {children}
    </div>
  );
}

function PopItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

const HINTS = ["pass this task to codex", "@all run the tests", "/handoff @api @web", "@docs update the README"];

function HintChip() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => (x + 1) % HINTS.length), 6000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div key={i} className="animate-rise rounded-full border border-line bg-surface/80 px-3 py-1 text-[12px] text-ink-3 backdrop-blur">
      Try <span className="font-semibold text-ink-2">“{HINTS[i]}”</span>
    </div>
  );
}

/** Installed third-party agent CLIs (gemini, opencode, aider …) from the backend catalog. */
function CatalogItems({ onPick }: { onPick: (program: string) => void }) {
  const [cat, setCat] = useState<CatalogStatus[] | null>(null);
  useEffect(() => {
    let live = true;
    ipc
      .detectAgents()
      .then((d) => live && setCat(d.catalog ?? []))
      .catch(() => live && setCat([]));
    return () => {
      live = false;
    };
  }, []);
  if (!cat) return <div className="px-3 py-1.5 text-[12px] text-ink-3">Looking for other agents…</div>;
  const have = cat.filter((c) => c.installed);
  const missing = cat.length - have.length;
  return (
    <>
      {have.length > 0 && <div className="mx-2 my-1 h-px bg-line" />}
      {have.map((c) => (
        <PopItem key={c.id} onClick={() => onPick(c.program)}>
          <CatalogIcon id={c.id} />
          {c.name}
        </PopItem>
      ))}
      {missing > 0 && (
        <div className="px-3 pb-1 pt-1.5 text-[11px] text-ink-3" title={cat.filter((c) => !c.installed).map((c) => `${c.name}: ${c.install}`).join("\n")}>
          +{missing} more supported (not installed)
        </div>
      )}
    </>
  );
}

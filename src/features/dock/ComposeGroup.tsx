import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentKind } from "../../lib/types";
import { AgentIcon } from "../../components/AgentIcon";
import { modelBadge, modelChoices } from "../../lib/models";
import { profilesFor } from "../settings/profiles";
import { useBoard } from "../../store/board";
import { popVariants } from "../../lib/motion";

export const ROLES = [
  { id: "frontend", label: "Frontend", color: "#f2a65a" },
  { id: "backend", label: "Backend", color: "#b48cff" },
  { id: "testers", label: "Testers", color: "#7bd389" },
  { id: "reviewers", label: "Reviewers", color: "#6aa8ff" },
  { id: "design", label: "Design", color: "#ff7eb6" },
  { id: "docs", label: "Docs", color: "#5fd4d4" },
  { id: "security", label: "Security", color: "#ff7a6b" },
  { id: "general", label: "General", color: "#a9aab6" },
] as const;
export type RoleId = (typeof ROLES)[number]["id"];

export const AGENT_CHOICES: { kind: AgentKind["kind"]; label: string; agent: AgentKind }[] = [
  { kind: "claudeCode", label: "Claude", agent: { kind: "claudeCode" } },
  { kind: "codex", label: "Codex", agent: { kind: "codex" } },
  { kind: "custom", label: "Shell", agent: { kind: "custom", program: "" } },
];

const TINT: Record<AgentKind["kind"], string> = {
  claudeCode: "border-claude/45 bg-claude/10 hover:bg-claude/20",
  codex: "border-codex/45 bg-codex/10 hover:bg-codex/20",
  custom: "border-line-strong bg-surface-2 hover:bg-surface-3",
};

const MIN = 1;
const MAX = 12;

/** Pure: members for a compose request (unit-tested). */
export function composeMembers(role: RoleId, kinds: AgentKind["kind"][], orchestrated = false) {
  const counts: Record<string, number> = {};
  const workers = kinds.map((k) => {
    const choice = AGENT_CHOICES.find((a) => a.kind === k)!;
    const base = role === "general" ? choice.label.toLowerCase() : role;
    counts[base] = (counts[base] ?? 0) + 1;
    return { title: `${base}-${counts[base]}`, agent: choice.agent } as { title: string; agent: AgentKind; lead?: boolean };
  });
  // orchestrated: an extra Claude lead first, that drives the workers through MCP tools
  return orchestrated ? [{ title: "lead", agent: { kind: "claudeCode" } as AgentKind, lead: true }, ...workers] : workers;
}

/** Per-member overrides set by clicking a not-yet-spawned agent tile. */
export interface MemberOverride {
  title?: string;
  model?: string;
  profile?: string;
}
export type ComposedMember = { title: string; agent: AgentKind; lead?: boolean; model?: string; profile?: string };

/** Pure: merge overrides (indexed by worker position, lead excluded) onto composed members. */
export function applyOverrides(members: ComposedMember[], overrides: Record<number, MemberOverride>, orchestrated: boolean): ComposedMember[] {
  const offset = orchestrated ? 1 : 0;
  return members.map((m, i) => {
    const o = overrides[i - offset];
    if (!o || m.lead) return m;
    const out: ComposedMember = { ...m };
    if (o.title?.trim()) out.title = o.title.trim();
    if (o.model?.trim()) out.model = o.model.trim();
    if (o.profile) out.profile = o.profile;
    return out;
  });
}

export function ComposeGroup({
  onBack,
  onSpawn,
}: {
  onBack: () => void;
  onSpawn: (name: string, members: ComposedMember[]) => void;
}) {
  const [overrides, setOverrides] = useState<Record<number, MemberOverride>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const profilesRaw = useBoard((s) => s.settings.profiles);
  const allProfiles = useMemo(() => profilesRaw ?? [], [profilesRaw]);
  const setOv = (i: number, p: MemberOverride) => setOverrides((o) => ({ ...o, [i]: { ...o[i], ...p } }));
  const [orchestrated, setOrchestrated] = useState(false);
  const [name, setName] = useState("Team");
  const [role, setRole] = useState<RoleId>("general");
  const [kinds, setKinds] = useState<AgentKind["kind"][]>(() => Array(4).fill("claudeCode"));
  const roleColor = useMemo(() => ROLES.find((r) => r.id === role)!.color, [role]);

  const resize = (n: number) =>
    setKinds((k) => {
      const next = Math.max(MIN, Math.min(MAX, n));
      return next > k.length ? [...k, ...Array(next - k.length).fill(k.at(-1) ?? "claudeCode")] : k.slice(0, next);
    });
  const setKind = (i: number, kind: AgentKind["kind"]) => {
    setKinds((k) => k.map((x, j) => (j === i ? kind : x)));
    // model / account belong to a CLI — reset them when the CLI changes
    setOverrides((o) => ({ ...o, [i]: { title: o[i]?.title } }));
  };
  const defaults = composeMembers(role, kinds, false);

  return (
    <div className="glass animate-rise w-[340px] rounded-2xl p-3 text-ink" role="dialog" aria-label="Compose group">
      <header className="mb-3 flex items-center gap-2">
        <button
          className="grid size-6 place-items-center rounded-md text-ink-2 transition hover:bg-surface-3 hover:text-ink"
          onClick={onBack}
          aria-label="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h3 className="text-[13px] font-semibold">Compose group</h3>
      </header>

      <label className="mb-3 flex h-10 items-center gap-2.5 rounded-xl border border-line bg-bg/60 px-3 transition focus-within:border-accent/70">
        <span className="size-2 shrink-0 rounded-full" style={{ background: roleColor }} />
        <input
          className="w-full bg-transparent text-[15px] font-semibold outline-none focus-visible:outline-none placeholder:text-ink-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          aria-label="Group name"
          autoFocus
        />
      </label>

      <div className="mb-3 flex flex-wrap gap-x-1 gap-y-1.5" role="radiogroup" aria-label="Role">
        {ROLES.map((r) => (
          <button
            key={r.id}
            role="radio"
            aria-checked={role === r.id}
            onClick={() => {
              setRole(r.id);
              if (name === "Team" || ROLES.some((x) => x.label === name)) setName(r.id === "general" ? "Team" : r.label);
            }}
            className={`flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] transition ${
              role === r.id ? "border border-line-strong bg-surface-3 font-semibold text-ink" : "border border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="size-1.5 rounded-full" style={{ background: r.color }} />
            {r.label}
          </button>
        ))}
      </div>

      <div className="mb-3 h-px bg-line" />

      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {kinds.map((k, i) => {
          const c = AGENT_CHOICES.find((a) => a.kind === k)!;
          return (
            <button
              key={i}
              onClick={() => setEditing(editing === i ? null : i)}
              title="Click to set name, agent and model"
              aria-pressed={editing === i}
              className={`flex h-[62px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] text-ink-2 transition active:scale-95 ${TINT[k]} ${editing === i ? "ring-2 ring-accent/70" : ""}`}
            >
              <span className="grid size-6 place-items-center rounded-md bg-black/30">
                <AgentIcon agent={k} size={16} />
              </span>
              <span className="max-w-full truncate px-1">{overrides[i]?.title?.trim() || defaults[i]?.title || c.label}</span>
              {modelBadge(overrides[i]?.model) && (
                <span className="-mt-0.5 max-w-full truncate px-1 font-mono text-[9.5px] text-accent">{modelBadge(overrides[i]?.model)}</span>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {editing !== null && editing < kinds.length && (
          <motion.div
            key="member-editor"
            variants={popVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-3 flex flex-col gap-2 rounded-xl border border-line-strong bg-bg/60 p-2.5"
            role="group"
            aria-label={`Agent ${editing + 1} settings`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-3">Agent {editing + 1}</span>
              <span className="flex-1" />
              <button className="text-[11px] text-ink-3 hover:text-ink" onClick={() => setEditing(null)}>
                Done
              </button>
            </div>
            <input
              className="h-8 rounded-lg border border-line bg-bg/80 px-2.5 text-[12.5px] font-semibold outline-none focus:border-accent/70"
              placeholder={defaults[editing]?.title}
              aria-label="Agent name"
              value={overrides[editing]?.title ?? ""}
              onChange={(e) => setOv(editing, { title: e.target.value })}
              autoFocus
            />
            <div className="flex gap-1" role="radiogroup" aria-label="Agent CLI">
              {AGENT_CHOICES.map((a) => (
                <button
                  key={a.kind}
                  role="radio"
                  aria-checked={kinds[editing] === a.kind}
                  onClick={() => setKind(editing, a.kind)}
                  className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[11.5px] transition ${
                    kinds[editing] === a.kind ? "border-accent/70 bg-accent/15 font-semibold text-ink" : "border-line text-ink-2 hover:bg-surface-3"
                  }`}
                >
                  <AgentIcon agent={a.kind} size={13} />
                  {a.label}
                </button>
              ))}
            </div>
            {modelChoices(kinds[editing]!).length > 0 && (
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Model">
                {modelChoices(kinds[editing]!).map((m) => {
                  const on = (overrides[editing]?.model ?? "") === m.id;
                  return (
                    <button
                      key={m.id || "default"}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setOv(editing, { model: m.id })}
                      className={`h-6 rounded-full border px-2.5 text-[11px] transition ${
                        on ? "border-accent/70 bg-accent/15 font-semibold text-ink" : "border-line text-ink-2 hover:bg-surface-3"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
            {(() => {
              const agent = AGENT_CHOICES.find((a) => a.kind === kinds[editing])!.agent;
              const profs = profilesFor(agent, allProfiles);
              if (!profs.length) return null;
              return (
                <select
                  className="h-7 rounded-lg border border-line bg-bg/80 px-2 text-[11.5px] text-ink-2 outline-none focus:border-accent/70"
                  aria-label="Account"
                  value={overrides[editing]?.profile ?? ""}
                  onChange={(e) => setOv(editing, { profile: e.target.value || undefined })}
                >
                  <option value="">Default login</option>
                  {profs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-3 flex items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-3">Fill all</span>
        {AGENT_CHOICES.map((a) => {
          const on = kinds.every((k) => k === a.kind);
          return (
            <button
              key={a.kind}
              onClick={() => setKinds((k) => k.map(() => a.kind))}
              title={`All ${a.label}`}
              aria-pressed={on}
              className={`grid size-7 place-items-center rounded-full transition hover:bg-surface-3 ${on ? "bg-surface-3 ring-1 ring-line-strong" : ""}`}
            >
              <AgentIcon agent={a.kind} size={16} />
            </button>
          );
        })}
      </div>

      <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-bg/40 px-3 py-2 transition hover:border-line-strong">
        <input
          type="checkbox"
          className="size-4 accent-[#ffb547]"
          checked={orchestrated}
          onChange={(e) => setOrchestrated(e.target.checked)}
          aria-label="Add an orchestrator lead"
        />
        <span className="flex flex-col">
          <span className="text-[12.5px] font-semibold text-ink">Add orchestrator lead</span>
          <span className="text-[11px] text-ink-3">A Claude lead that splits the goal and delegates to these agents</span>
        </span>
      </label>

      <footer className="flex items-center gap-2">
        <button className="grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-30" onClick={() => resize(kinds.length - 1)} disabled={kinds.length <= MIN} aria-label="Fewer">
          −
        </button>
        <span className="w-6 text-center text-[14px] font-semibold tabular-nums" aria-live="polite">{kinds.length}</span>
        <button className="grid size-7 place-items-center rounded-full text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-30" onClick={() => resize(kinds.length + 1)} disabled={kinds.length >= MAX} aria-label="More">
          +
        </button>
        <button
          className="ml-auto h-9 rounded-full bg-ink/80 px-5 text-[13px] font-semibold text-bg transition hover:bg-ink active:scale-95"
          onClick={() => onSpawn(name.trim() || "Team", applyOverrides(composeMembers(role, kinds, orchestrated), overrides, orchestrated))}
        >
          Spawn {kinds.length + (orchestrated ? 1 : 0)}
        </button>
      </footer>
    </div>
  );
}

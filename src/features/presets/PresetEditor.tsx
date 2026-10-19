// Create / edit an agent preset: name, icon, CLI + account + model, role, focus skills,
// extra MCP servers, lead. Saved in Settings → shows up on the sidebar.
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { fadeVariants, popVariants } from "../../lib/motion";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import type { AgentPreset, CatalogStatus, Skill } from "../../lib/types";
import { AgentPicker } from "../../components/AgentPicker";
import { profilesFor } from "../settings/profiles";
import { PresetIcon } from "./PresetIcon";
import { blankPreset, cleanPreset, MAX_ICON_BYTES, PRESET_COLORS, validatePreset } from "./presets";

const EMOJIS = ["🤖", "🧭", "📋", "🧪", "🛠️", "🎨", "🔍", "📝", "🚀", "🧠", "🛡️", "📊"];
const LOGOS = ["devicon:claudeCode", "devicon:codex", "devicon:gemini", "devicon:opencode", "devicon:cursor", "devicon:copilot", "devicon:qwen", "devicon:amp"];

export function PresetEditor({ preset, onClose }: { preset: AgentPreset | null; onClose: () => void }) {
  const settings = useBoard((s) => s.settings);
  const all = settings.agentPresets ?? [];
  const [p, setP] = useState<AgentPreset>(() => preset ?? blankPreset(`ap-${Date.now().toString(36)}`, all.length));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogStatus[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const patch = (x: Partial<AgentPreset>) => setP((v) => ({ ...v, ...x }));
  const isClaude = (p.agent?.kind ?? "claudeCode") === "claudeCode";

  useEffect(() => {
    void ipc.detectAgents().then((d) => setCatalog(d.catalog ?? [])).catch(() => undefined);
    void ipc.listSkills("claude", null, null).then(setSkills).catch(() => setSkills([]));
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [onClose]);

  const accounts = useMemo(() => (p.agent ? profilesFor(p.agent, settings.profiles ?? []) : []), [p.agent, settings.profiles]);

  const upload = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(svg\+xml|png|webp|jpeg)$/.test(f.type)) return setErr("Icon: SVG, PNG, WebP or JPG");
    if (f.size > MAX_ICON_BYTES) return setErr("Icon file is larger than 64 KB");
    const r = new FileReader();
    r.onload = () => patch({ icon: String(r.result) });
    r.readAsDataURL(f);
  };

  const save = async () => {
    const c = cleanPreset(p);
    const bad = validatePreset(c, all.filter((x) => x.id !== c.id).map((x) => x.name));
    if (bad) return setErr(bad);
    setBusy(true);
    try {
      const list = all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c];
      const res = await ipc.saveSettings({ ...settings, agentPresets: list });
      useBoard.getState().setSettings(res.settings, res.resolvedCwd);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!preset) return onClose();
    const res = await ipc.saveSettings({ ...settings, agentPresets: all.filter((x) => x.id !== preset.id) });
    useBoard.getState().setSettings(res.settings, res.resolvedCwd);
    onClose();
  };

  return (
    <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/50" variants={fadeVariants} initial="initial" animate="animate" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div variants={popVariants} initial="initial" animate="animate" role="dialog" aria-label="Agent preset" className="glass max-h-[90vh] w-[600px] max-w-[94vw] overflow-y-auto rounded-2xl p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl border" style={{ borderColor: `${p.color}88`, background: `${p.color}1f` }}>
            <PresetIcon icon={p.icon} size={24} agent={p.agent} />
          </span>
          <input className="input flex-1 text-[15px] font-semibold" aria-label="Preset name" placeholder="Agent name, e.g. PO" value={p.name} autoFocus onChange={(e) => patch({ name: e.target.value })} />
          <button className="btn icon ghost" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="field">
          <label>Icon</label>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Icon">
            {[...LOGOS, ...EMOJIS.map((e) => `emoji:${e}`)].map((ic) => (
              <button
                key={ic}
                type="button"
                role="radio"
                aria-checked={p.icon === ic}
                aria-label={ic}
                className={`grid size-8 place-items-center rounded-lg border transition ${p.icon === ic ? "border-accent bg-surface-3" : "border-line hover:border-line-strong"}`}
                onClick={() => patch({ icon: ic })}
              >
                <PresetIcon icon={ic} size={16} />
              </button>
            ))}
            <label className="btn ghost sm cursor-pointer">
              Upload…
              <input type="file" accept=".svg,.png,.webp,.jpg,.jpeg" className="hidden" aria-label="Upload icon" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Colour">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={p.color === c} aria-label={`Colour ${c}`} className={`size-5 rounded-full ${p.color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`} style={{ background: c }} onClick={() => patch({ color: c })} />
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="field">
            <label>Agent CLI</label>
            <AgentPicker label="Agent CLI" value={p.agent ?? { kind: "claudeCode" }} catalog={catalog} onChange={(a) => patch({ agent: a, profile: null, model: null })} />
          </div>
          <div className="field">
            <label htmlFor="pr-acct">Account</label>
            <select id="pr-acct" className="input" value={p.profile ?? ""} onChange={(e) => patch({ profile: e.target.value || null })} disabled={!accounts.length}>
              <option value="">Default login</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pr-model">Model (optional)</label>
            <input id="pr-model" className="input" placeholder={isClaude ? "opus / sonnet / glm-5.3[1m]" : "e.g. gpt-5-codex"} value={p.model ?? ""} onChange={(e) => patch({ model: e.target.value || null })} />
          </div>
          <label className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={p.lead} disabled={!isClaude} onChange={(e) => patch({ lead: e.target.checked })} />
            Orchestrator lead (can drive other consoles)
          </label>
        </div>

        <div className="field mt-3">
          <label htmlFor="pr-role">Role &amp; instructions</label>
          <textarea id="pr-role" className="input min-h-28 text-[13px]" placeholder={"e.g. You are the Product Owner. Turn requests into user stories with acceptance criteria and keep the Kanban up to date."} value={p.role} onChange={(e) => patch({ role: e.target.value })} />
          {!isClaude && <span className="help text-warn">Role, skills and MCP apply to Claude Code consoles only.</span>}
        </div>

        <div className="field mt-3">
          <label>Focus skills</label>
          {skills.length === 0 ? (
            <span className="help">No Claude skills installed yet (Skills &amp; MCP on the sidebar).</span>
          ) : (
            <div className="flex flex-wrap gap-1.5" aria-label="Focus skills">
              {skills.map((s) => {
                const on = p.skills.includes(s.name);
                return (
                  <button key={s.name} type="button" aria-pressed={on} title={s.description} className={`chip ${on ? "on" : "off"} cursor-pointer`} onClick={() => patch({ skills: on ? p.skills.filter((x) => x !== s.name) : [...p.skills, s.name] })}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
          <span className="help">Claude still sees every installed skill — these are the ones this agent is told to prefer.</span>
        </div>

        <div className="field mt-3">
          <label>Extra MCP servers</label>
          {p.mcp.map((m, i) => (
            <div key={i} className="mb-1.5 flex gap-1.5">
              <input className="input w-36" placeholder="name" aria-label={`MCP ${i + 1} name`} value={m.name} onChange={(e) => patch({ mcp: p.mcp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="input flex-1 font-mono text-[12px]" placeholder="npx -y @org/server  or  https://…" aria-label={`MCP ${i + 1} command or URL`} value={m.target} onChange={(e) => patch({ mcp: p.mcp.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) })} />
              <button className="btn icon ghost" aria-label={`Remove MCP ${i + 1}`} onClick={() => patch({ mcp: p.mcp.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn ghost sm self-start" onClick={() => patch({ mcp: [...p.mcp, { name: "", target: "" }] })}>
            + MCP server
          </button>
        </div>

        {err && (
          <p className="help mt-2 text-danger" role="alert">
            {err}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          {preset && (
            <button className="btn ghost sm text-danger" onClick={() => void remove()}>
              Delete preset
            </button>
          )}
          <span className="flex-1" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {preset ? "Save" : "Create agent"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

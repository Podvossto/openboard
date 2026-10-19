import type { AgentKind, Profile, ProviderPreset } from "./types";

/** Model choices offered per CLI (passed as --model). "" = the CLI's own default. Free text is also allowed. */
export const MODEL_CHOICES: Record<"claudeCode" | "codex", { id: string; label: string }[]> = {
  claudeCode: [
    { id: "", label: "Default" },
    { id: "opus", label: "Opus" },
    { id: "sonnet", label: "Sonnet" },
    { id: "haiku", label: "Haiku" },
  ],
  codex: [
    { id: "", label: "Default" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" },
    { id: "gpt-5", label: "GPT-5" },
  ],
};

/**
 * Model choices for a console. With a provider profile (Z.ai …) Claude's opus/sonnet/haiku
 * aliases are wrong — Claude Code would map them to the provider's default anyway — so the
 * provider's own model ids are offered instead ("" = the profile's configured model).
 */
export function modelChoices(agent: AgentKind | AgentKind["kind"], profile?: Profile, presets: ProviderPreset[] = []) {
  const k = typeof agent === "string" ? agent : agent.kind;
  if (profile?.kind.type === "provider") {
    const kind = profile.kind;
    const preset = presets.find((p) => p.id === kind.provider);
    const ids = [...new Set([kind.model, ...(preset?.models ?? [])].filter(Boolean))];
    return [{ id: "", label: `Default${kind.model ? ` (${prettyProviderModel(kind.model)})` : ""}` }, ...ids.filter((m) => m !== kind.model).map((id) => ({ id, label: prettyProviderModel(id) }))];
  }
  return k === "claudeCode" || k === "codex" ? MODEL_CHOICES[k] : [];
}

/** "glm-5.3-flash[1m]" → "GLM-5.3 Flash · 1M" */
export function prettyProviderModel(id: string): string {
  const ctx = /\[(\d+)([km])\]$/i.exec(id);
  let base = id.replace(/\[[^\]]*\]$/, "");
  const m = /^glm-([\d.]+)(?:-(\w+))?$/i.exec(base);
  if (m) base = `GLM-${m[1]}${m[2] ? ` ${m[2][0]!.toUpperCase()}${m[2].slice(1)}` : ""}`;
  return ctx ? `${base} · ${ctx[1]}${ctx[2]!.toUpperCase()}` : base;
}

/** Short label for a header badge; undefined when no override. */
export function modelBadge(model: string | undefined): string | undefined {
  const m = model?.trim();
  if (!m) return undefined;
  const known = [...MODEL_CHOICES.claudeCode, ...MODEL_CHOICES.codex].find((c) => c.id === m);
  return known?.label ?? m;
}

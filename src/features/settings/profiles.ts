import type { AgentKind, Profile, ProfileKind, ProviderPreset } from "../../lib/types";

export const PROFILE_COLORS = ["#8ea2ff", "#5fd4a8", "#f2b45c", "#e57ad8", "#6fd0e8", "#ff8a7a"];

export const newProfileId = () => `prof-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const presetToKind = (p: ProviderPreset): ProfileKind => ({
  type: "provider",
  provider: p.id,
  baseUrl: p.baseUrl,
  model: p.model,
  smallModel: p.smallModel,
});

/** Profiles usable for a console of this agent (provider profiles drive Claude Code). */
export function profilesFor(agent: AgentKind, all: Profile[]): Profile[] {
  if (agent.kind === "claudeCode") return all.filter((p) => p.cli === "claude");
  if (agent.kind === "codex") return all.filter((p) => p.cli === "codex");
  return [];
}

export const profileLabel = (p: Profile | undefined) => p?.name ?? "Default login";

import type { AgentKind } from "./types";

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

export function modelChoices(agent: AgentKind | AgentKind["kind"]) {
  const k = typeof agent === "string" ? agent : agent.kind;
  return k === "claudeCode" || k === "codex" ? MODEL_CHOICES[k] : [];
}

/** Short label for a header badge; undefined when no override. */
export function modelBadge(model: string | undefined): string | undefined {
  const m = model?.trim();
  if (!m) return undefined;
  const known = [...MODEL_CHOICES.claudeCode, ...MODEL_CHOICES.codex].find((c) => c.id === m);
  return known?.label ?? m;
}

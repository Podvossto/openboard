// Preset icon: devicon (CLI logo), emoji, or an uploaded svg/png data URL.
import type { AgentKind } from "../../lib/types";
import { AgentIcon, CatalogIcon } from "../../components/AgentIcon";

export function PresetIcon({ icon, size = 18, agent }: { icon: string; size?: number; agent?: AgentKind | null }) {
  if (icon.startsWith("data:image/"))
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" className="shrink-0 rounded-[4px] object-contain" draggable={false} />;
  if (icon.startsWith("emoji:"))
    return (
      <span aria-hidden="true" style={{ fontSize: size * 0.95, lineHeight: 1 }} className="shrink-0 select-none">
        {icon.slice(6)}
      </span>
    );
  if (icon.startsWith("devicon:")) {
    const id = icon.slice(8);
    if (id === "claudeCode" || id === "codex") return <AgentIcon agent={id} size={size} />;
    return <CatalogIcon id={id} size={size} />;
  }
  return <AgentIcon agent={agent?.kind ?? "claudeCode"} size={size} />;
}

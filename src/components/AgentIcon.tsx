import type { AgentKind } from "../lib/types";

/** Small brand-ish glyphs (original drawings, not vendor logos). */
export function AgentIcon({ agent, size = 18 }: { agent: AgentKind["kind"]; size?: number }) {
  if (agent === "claudeCode")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <g stroke="#e8784b" strokeWidth="2.2" strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * Math.PI) / 4;
            return (
              <line
                key={i}
                x1={12 + Math.cos(a) * 3}
                y1={12 + Math.sin(a) * 3}
                x2={12 + Math.cos(a) * (i % 2 ? 8 : 10)}
                y2={12 + Math.sin(a) * (i % 2 ? 8 : 10)}
              />
            );
          })}
        </g>
        <circle cx="12" cy="12" r="2.6" fill="#f3a07a" />
      </svg>
    );
  if (agent === "codex")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="cx" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8aa4ff" />
            <stop offset="1" stopColor="#4d6bff" />
          </linearGradient>
        </defs>
        <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="url(#cx)" />
        <path d="M9 9.5l-2.2 2.5L9 14.5M12.5 15h4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="3" stroke="#a9aab6" strokeWidth="1.7" />
      <path d="M7 10l2.5 2L7 14M11.5 15h5" stroke="#a9aab6" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Animated gradient orb used as the composer avatar. */
export function Orb({ busy = false }: { busy?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block size-9 shrink-0 rounded-full ${busy ? "animate-spin [animation-duration:2.4s]" : ""}`}
      style={{
        background:
          "radial-gradient(circle at 35% 30%, #ffe2a8 0 12%, transparent 30%), conic-gradient(from 200deg, #ff7a3d, #ffb14a, #ff5f6d, #c2410c, #ff7a3d)",
        boxShadow: "0 0 22px -2px rgb(255 122 61 / 0.55), inset 0 -4px 10px rgb(0 0 0 / 0.35)",
      }}
    />
  );
}

const CAT_TINT: Record<string, string> = {
  gemini: "#6aa8ff", opencode: "#c9cbd6", aider: "#5fd4a8", qwen: "#8b7bff", copilot: "#c8d0ff",
  cursor: "#e8e8ee", amp: "#ff6a5c", goose: "#f2d45a", crush: "#ff7ac8", grok: "#e6e6e6", kimi: "#7cc4ff", droid: "#ffa45c",
};

/** program → catalog id (for consoles started from the catalog) */
export const PROGRAM_TO_CATALOG: Record<string, string> = {
  gemini: "gemini", opencode: "opencode", aider: "aider", qwen: "qwen", copilot: "copilot", "cursor-agent": "cursor",
  amp: "amp", goose: "goose", crush: "crush", grok: "grok", kimi: "kimi", droid: "droid",
};

// Vendor logos from devicons.io (MIT; each logo is its owner's trademark). Missing ids
// (aider, crush, droid — not on devicons) fall back to the tinted letter tile.
const LOGOS = import.meta.glob<string>("../assets/agent-logos/*.svg", { eager: true, query: "?url", import: "default" });
export const logoUrl = (id: string): string | undefined => LOGOS[`../assets/agent-logos/${id}.svg`];

/** Vendor logo when we have one, else a letter tile tinted per agent. */
export function CatalogIcon({ id, size = 15 }: { id: string; size?: number }) {
  const src = logoUrl(id);
  if (src) return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="shrink-0 object-contain" data-logo={id} draggable={false} />;
  const tint = CAT_TINT[id] ?? "#a9aab6";
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[5px] font-bold"
      style={{ width: size, height: size, fontSize: size * 0.62, color: tint, boxShadow: `inset 0 0 0 1.5px ${tint}` }}
    >
      {id[0]!.toUpperCase()}
    </span>
  );
}

/** Icon for any console agent: built-ins, catalog CLIs, else the shell glyph. */
export function ConsoleAgentIcon({ agent, size = 16 }: { agent: AgentKind; size?: number }) {
  if (agent.kind === "custom") {
    const base = agent.program.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat)$/i, "");
    const id = PROGRAM_TO_CATALOG[base];
    if (id) return <CatalogIcon id={id} size={size} />;
  }
  return <AgentIcon agent={agent.kind} size={size} />;
}

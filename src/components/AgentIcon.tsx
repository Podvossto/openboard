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

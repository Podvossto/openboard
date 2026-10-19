// Searchable dropdown of every agent CLI (Claude Code, Codex, Shell + installed catalog CLIs).
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentKind, CatalogStatus } from "../lib/types";
import { AgentIcon, CatalogIcon } from "./AgentIcon";
import { agentChoices, agentKey, filterChoices, type AgentChoice } from "./agentChoices";

export function AgentPicker({
  value,
  onChange,
  catalog,
  label = "Agent",
}: {
  value: AgentKind;
  onChange: (a: AgentKind) => void;
  catalog: CatalogStatus[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const all = useMemo(() => agentChoices(catalog), [catalog]);
  const list = useMemo(() => filterChoices(all, q), [all, q]);
  const cur = all.find((c) => c.key === agentKey(value)) ?? all[0]!;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [open]);

  const pick = (c: AgentChoice) => {
    onChange(c.agent);
    setOpen(false);
    setQ("");
  };

  const icon = (c: AgentChoice) =>
    c.catalogId ? <CatalogIcon id={c.catalogId} size={15} /> : <AgentIcon agent={c.agent.kind === "custom" ? "custom" : c.agent.kind} size={15} />;

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="input flex w-full items-center gap-2 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${cur.label}`}
        onClick={() => {
          setOpen((v) => !v);
          setHi(0);
        }}
      >
        {icon(cur)}
        <span className="flex-1 truncate">{cur.label}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-ink-3" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="glass absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl p-1.5 shadow-2xl">
          <input
            autoFocus
            className="input mb-1 w-full"
            placeholder="Search agents…"
            aria-label="Search agents"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter" && list[hi]) {
                e.preventDefault();
                pick(list[hi]!);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          <ul role="listbox" aria-label={label} className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {list.map((c, i) => (
              <li key={c.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.key === cur.key}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] ${i === hi ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2"}`}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(c)}
                >
                  {icon(c)}
                  <span className="flex-1 truncate">{c.label}</span>
                  {!c.installed && <span className="chip off !text-[10px]">not installed</span>}
                  {c.key === cur.key && <span className="text-accent">✓</span>}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-2 py-2 text-[12px] text-ink-3">No agent matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

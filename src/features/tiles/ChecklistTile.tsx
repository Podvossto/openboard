import { useState } from "react";
import type { Tile, TileData } from "../../lib/types";
import { checklistMarkdown, checklistProgress, localId } from "./logic";
import { SendToConsole } from "./SendToConsole";

export function ChecklistTile({ tile, setData }: { tile: Tile<"checklist">; setData: (d: TileData["checklist"]) => void }) {
  const items = tile.data.items ?? [];
  const [draft, setDraft] = useState("");
  const { done, total } = checklistProgress(items);
  const set = (next: typeof items) => setData({ items: next });
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    set([...items, { id: localId("it"), text: t, done: false }]);
    setDraft("");
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-ok transition-[width] duration-300" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
        </div>
        <span className="text-[11.5px] font-semibold tabular-nums text-ink-3">
          {done}/{total}
        </span>
        <SendToConsole text={() => checklistMarkdown(tile.title, items)} disabled={!total} />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {items.map((it) => (
          <li key={it.id} className="group/it flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-2">
            <button
              role="checkbox"
              aria-checked={it.done}
              aria-label={it.text}
              className={`grid size-[18px] shrink-0 place-items-center rounded-md border transition ${
                it.done ? "border-ok bg-ok text-bg" : "border-line-strong hover:border-ok"
              }`}
              onClick={() => set(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
            >
              {it.done && (
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 6.2l2.2 2.2 4.8-4.9" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className={`min-w-0 flex-1 break-words text-[13.5px] ${it.done ? "text-ink-3 line-through" : "text-ink"}`}>{it.text}</span>
            <button
              className="text-[12px] text-ink-3 opacity-0 transition hover:text-danger group-hover/it:opacity-100"
              aria-label={`Delete ${it.text}`}
              onClick={() => set(items.filter((x) => x.id !== it.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-2">
        <input
          aria-label="New checklist item"
          className="h-9 w-full rounded-xl border border-line bg-bg/70 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70"
          placeholder="Add an item and press Enter"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
      </div>
    </div>
  );
}

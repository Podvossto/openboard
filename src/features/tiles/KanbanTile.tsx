import { useState } from "react";
import type { KanbanColumn, Tile, TileData } from "../../lib/types";
import { localId, moveCard } from "./logic";

const MIME = "application/x-agentboard-card";

/** Kanban: columns of cards; drag cards between/within columns (HTML5 DnD). */
export function KanbanTile({ tile, setData }: { tile: Tile<"kanban">; setData: (d: TileData["kanban"]) => void }) {
  const cols = tile.data.columns ?? [];
  const set = (columns: KanbanColumn[]) => setData({ columns });
  const [drop, setDrop] = useState<{ col: string; index: number } | null>(null);

  const onDrop = (col: string, index: number, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(MIME);
    setDrop(null);
    if (id) set(moveCard(cols, id, col, index));
  };

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {cols.map((col) => (
        <section
          key={col.id}
          aria-label={`Column ${col.name}`}
          className="flex w-56 min-w-56 flex-col rounded-2xl border border-line bg-surface-2/60"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(MIME)) return;
            e.preventDefault();
            if (drop?.col !== col.id) setDrop({ col: col.id, index: col.cards.length });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
          }}
          onDrop={(e) => onDrop(col.id, drop?.col === col.id ? drop.index : col.cards.length, e)}
        >
          <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
            <input
              aria-label="Column name"
              className="min-w-0 flex-1 bg-transparent text-[12px] font-bold uppercase tracking-[0.08em] text-ink-2 outline-none focus:text-ink"
              defaultValue={col.name}
              onBlur={(e) => {
                const name = e.target.value.trim() || col.name;
                if (name !== col.name) set(cols.map((c) => (c.id === col.id ? { ...c, name } : c)));
              }}
            />
            <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold text-ink-3">{col.cards.length}</span>
          </header>
          <div className="flex min-h-10 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
            {col.cards.map((card, i) => (
              <div key={card.id}>
                {drop?.col === col.id && drop.index === i && <div className="mb-1.5 h-0.5 rounded-full bg-accent" />}
                <article
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MIME, card.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDrop(null)}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(MIME)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                    if (drop?.col !== col.id || drop.index !== index) setDrop({ col: col.id, index });
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    onDrop(col.id, drop?.col === col.id ? drop.index : i, e);
                  }}
                  className="group/card flex cursor-grab items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink shadow-sm transition hover:border-line-strong active:cursor-grabbing"
                >
                  <span className="min-w-0 flex-1 break-words">{card.text}</span>
                  <button
                    className="text-[11px] text-ink-3 opacity-0 transition hover:text-danger group-hover/card:opacity-100"
                    aria-label={`Delete card ${card.text}`}
                    onClick={() =>
                      set(cols.map((c) => (c.id === col.id ? { ...c, cards: c.cards.filter((k) => k.id !== card.id) } : c)))
                    }
                  >
                    ✕
                  </button>
                </article>
              </div>
            ))}
            {drop?.col === col.id && drop.index === col.cards.length && <div className="h-0.5 rounded-full bg-accent" />}
          </div>
          <AddCard
            onAdd={(text) =>
              set(cols.map((c) => (c.id === col.id ? { ...c, cards: [...c.cards, { id: localId("card"), text }] } : c)))
            }
          />
        </section>
      ))}
      <button
        className="h-9 min-w-36 self-start rounded-full border border-dashed border-line-strong px-3 text-[12.5px] font-semibold text-ink-3 transition hover:border-accent hover:text-ink"
        onClick={() => set([...cols, { id: localId("col"), name: "New column", cards: [] }])}
      >
        + Column
      </button>
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="p-2 pt-0">
      <input
        aria-label="New card"
        className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 hover:bg-surface-3/60 focus:border-line focus:bg-bg/70"
        placeholder="+ Add card"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) {
            onAdd(v.trim());
            setV("");
          }
        }}
      />
    </div>
  );
}

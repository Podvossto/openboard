import { useState } from "react";
import type { CalEvent, Tile, TileData } from "../../lib/types";
import { addDays, addMonths, dayLabel, dow, isSameMonth, monthGrid, monthLabel, shortLabel, todayISO, WEEKDAYS, weekOf } from "./calendar";
import { localId } from "./logic";

const COLORS = ["#f2b45c", "#7bd389", "#8ea2ff", "#e57ad8", "#ff8a7a", "#56d8c9"];
const iconBtn = "grid size-6 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink";

type Form = { mode: "new"; date: string } | { mode: "edit"; ev: CalEvent };

/** Month/week calendar: click a day to add an event, click a chip to edit or delete it. */
export function CalendarTile({ tile, setData }: { tile: Tile<"calendar">; setData: (d: TileData["calendar"]) => void }) {
  const events = tile.data.events ?? [];
  const view = tile.data.view ?? "month";
  const cursor = tile.data.cursor || todayISO();
  const today = todayISO();
  const [form, setForm] = useState<Form | null>(null);

  const set = (p: Partial<TileData["calendar"]>) => setData({ events, view, cursor, ...p });
  const save = (ev: CalEvent) => {
    setForm(null);
    set({ events: events.some((e) => e.id === ev.id) ? events.map((e) => (e.id === ev.id ? ev : e)) : [...events, ev] });
  };
  const remove = (id: string) => {
    setForm(null);
    set({ events: events.filter((e) => e.id !== id) });
  };
  const openDay = (date: string) => {
    set({ cursor: date });
    setForm({ mode: "new", date });
  };
  const step = (dir: number) => set({ cursor: view === "month" ? addMonths(cursor, dir) : addDays(cursor, dir * 7) });
  const on = (date: string) => events.filter((e) => e.date === date);

  const head = view === "month" ? monthLabel(cursor) : `${dayLabel(weekOf(cursor)[0] ?? cursor)} – ${dayLabel(weekOf(cursor)[6] ?? cursor)}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button className={iconBtn} aria-label="Previous" title="Previous" onClick={() => step(-1)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 5l-7 7 7 7" />
          </svg>
        </button>
        <button className={iconBtn} aria-label="Next" title="Next" onClick={() => step(1)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.5 5l7 7-7 7" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold text-ink">{head}</span>
        <button
          className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-ink-3 transition hover:bg-surface-3 hover:text-ink"
          aria-label="Today"
          onClick={() => set({ cursor: todayISO() })}
        >
          Today
        </button>
        <div role="group" aria-label="Calendar view" className="flex items-center rounded-full border border-line p-0.5">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              aria-label={`${v === "month" ? "Month" : "Week"} view`}
              aria-pressed={view === v}
              className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold transition ${
                view === v ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink"
              }`}
              onClick={() => set({ view: v })}
            >
              {v === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-1.5">
          <div className="grid grid-cols-7 pb-1">
            {WEEKDAYS.map((d) => (
              <span key={d} className="text-center text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
                {d}
              </span>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-xl bg-line/60">
            {monthGrid(cursor).map((date) => {
              const inMonth = isSameMonth(date, cursor);
              const dayEvents = on(date);
              return (
                <div
                  key={date}
                  role="button"
                  tabIndex={0}
                  aria-label={date}
                  title={`Add event — ${shortLabel(date)}`}
                  onClick={() => openDay(date)}
                  onKeyDown={(e) => e.key === "Enter" && openDay(date)}
                  className={`group/day flex min-h-0 cursor-pointer flex-col gap-0.5 bg-surface p-1 transition hover:bg-surface-2 ${
                    date === today ? "ring-1 ring-inset ring-accent" : ""
                  }`}
                >
                  <span
                    className={`px-0.5 text-[10.5px] font-semibold tabular-nums ${
                      date === today
                        ? "grid h-[18px] min-w-[18px] place-items-center self-start rounded-full bg-accent px-1 text-bg"
                        : inMonth
                          ? "text-ink-2"
                          : "text-ink-3/50"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>
                  <div className="flex min-h-0 flex-1 flex-col items-stretch gap-0.5 overflow-y-auto">
                    {dayEvents.map((ev) => (
                      <Chip key={ev.id} ev={ev} onEdit={() => setForm({ mode: "edit", ev })} />
                    ))}
                    {dayEvents.length > 0 && (
                      <span className="sr-only">{`${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}`}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-1.5 px-2 pb-1.5">
          {weekOf(cursor).map((date) => (
            <section
              key={date}
              aria-label={shortLabel(date)}
              className={`flex min-w-0 flex-1 flex-col rounded-xl border bg-surface-2/40 ${
                date === today ? "border-accent/60" : "border-line"
              }`}
            >
              <button
                className="flex items-center justify-center gap-1 border-b border-line/60 px-1 py-1 text-[11px] font-semibold transition hover:bg-surface-2"
                aria-label={`Add event ${date}`}
                title={`Add event — ${shortLabel(date)}`}
                onClick={() => openDay(date)}
              >
                <span className={date === today ? "text-accent" : "text-ink-2"}>{dayLabel(date)}</span>
              </button>
              <div className="flex min-h-0 flex-1 flex-col items-stretch gap-1 overflow-y-auto p-1">
                {on(date).map((ev) => (
                  <Chip key={ev.id} ev={ev} wide onEdit={() => setForm({ mode: "edit", ev })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {form && (
        <EventForm
          key={form.mode === "edit" ? form.ev.id : form.date}
          form={form}
          onCancel={() => setForm(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}

function Chip({ ev, onEdit, wide }: { ev: CalEvent; onEdit: () => void; wide?: boolean }) {
  return (
    <button
      className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-left text-[10px] font-semibold leading-tight transition hover:brightness-125 ${wide ? "" : "min-w-0"}`}
      style={{ background: `${ev.color}26`, color: ev.color, boxShadow: `inset 0 0 0 1px ${ev.color}59` }}
      aria-label={ev.title}
      title={`${ev.title}${ev.time ? ` · ${ev.time}` : ""} — click to edit`}
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {ev.time && <span className="shrink-0 tabular-nums opacity-80">{ev.time}</span>}
      <span className={`min-w-0 truncate ${wide ? "flex-1" : ""}`}>{ev.title}</span>
    </button>
  );
}

/** Inline add/edit form at the bottom of the tile. */
function EventForm({
  form,
  onCancel,
  onSave,
  onDelete,
}: {
  form: Form;
  onCancel: () => void;
  onSave: (ev: CalEvent) => void;
  onDelete: (id: string) => void;
}) {
  const editing = form.mode === "edit" ? form.ev : undefined;
  const date = editing ? editing.date : form.mode === "new" ? form.date : "";
  const [title, setTitle] = useState(editing?.title ?? "");
  const [time, setTime] = useState(editing?.time ?? "");
  const [color, setColor] = useState(editing?.color ?? COLORS[/^\d{4}-\d{2}-\d{2}$/.test(date) ? dow(date) % COLORS.length : 0] ?? COLORS[0]!);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onSave({ id: editing?.id ?? localId("ev"), date, title: t, ...(time.trim() ? { time: time.trim() } : {}), color });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-2 py-1.5" role="form" aria-label={editing ? "Edit event" : "New event"}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-3">
          {editing ? "Edit event ·" : "New event ·"} {shortLabel(date)}
        </span>
        <button
          className="grid size-5 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink"
          aria-label="Cancel event"
          title="Cancel"
          onClick={onCancel}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Event title"
          className="h-7 min-w-0 flex-1 rounded-full border border-line bg-bg/70 px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70"
          placeholder="Event title"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <input
          aria-label="Event time"
          className="h-7 w-[74px] rounded-full border border-line bg-bg/70 px-2.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/70"
          placeholder="09:00"
          value={time}
          onChange={(e) => setTime(e.target.value.slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div role="group" aria-label="Event color" className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Color ${c}`}
              className={`size-4 rounded-full transition ${color === c ? "ring-2 ring-white/70 ring-offset-1 ring-offset-surface" : "opacity-60 hover:opacity-100"}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        {editing ? (
          <>
            <button
              className="h-7 rounded-full border border-line px-2.5 text-[11.5px] font-semibold text-ink-2 transition hover:border-danger hover:text-danger"
              aria-label="Delete event"
              onClick={() => onDelete(editing.id)}
            >
              Delete
            </button>
            <button
              className="h-7 rounded-full bg-ink px-2.5 text-[11.5px] font-semibold text-bg transition hover:bg-white active:scale-95 disabled:opacity-40"
              aria-label="Save event"
              disabled={!title.trim()}
              onClick={submit}
            >
              Save
            </button>
          </>
        ) : (
          <button
            className="h-7 rounded-full bg-ink px-2.5 text-[11.5px] font-semibold text-bg transition hover:bg-white active:scale-95 disabled:opacity-40"
            aria-label="Add event"
            disabled={!title.trim()}
            onClick={submit}
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}

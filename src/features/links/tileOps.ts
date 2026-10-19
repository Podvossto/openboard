// Agent → tile operations (pure, unit-tested). The backend forwards an agent's MCP tool
// call as `tile://op`; `applyTileOp` returns the new tile data + a short text for the agent.
import type { CalEvent, ChecklistItem, KanbanColumn, Tile } from "../../lib/types";

export type OpResult<T> = { ok: true; data: T; text: string } | { ok: false; error: string };

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

/** Linkable tile kinds (agent tools exist for these). */
export const LINKABLE = ["kanban", "checklist", "calendar"] as const;
export type LinkableKind = (typeof LINKABLE)[number];
export const isLinkable = (k: string): k is LinkableKind => (LINKABLE as readonly string[]).includes(k);

const pick = <T extends { id: string }>(list: T[], key: string, label: (x: T) => string): T | undefined =>
  list.find((x) => x.id === key) ?? list.find((x) => label(x).toLowerCase() === key.toLowerCase());

function kanban(cols: KanbanColumn[], tool: string, a: Args, newId: () => string): OpResult<{ columns: KanbanColumn[] }> {
  const findCard = (key: string) => {
    for (const c of cols) {
      const card = pick(c.cards, key, (x) => x.text);
      if (card) return { col: c, card };
    }
    return null;
  };
  const colOf = (key: string) => pick(cols, key, (x) => x.name);
  const names = () => cols.map((c) => c.name).join(", ");
  switch (tool) {
    case "kanban_list":
      return {
        ok: true,
        data: { columns: cols },
        text: cols.map((c) => `## ${c.name} (${c.id})\n${c.cards.map((k) => `- [${k.id}] ${k.text}`).join("\n") || "(empty)"}`).join("\n\n"),
      };
    case "kanban_add_card": {
      const want = str(a, "column");
      const col = want ? colOf(want) : cols[0];
      if (!col) return { ok: false, error: want ? `no column "${want}". Columns: ${names()}` : "the board has no columns" };
      const card = { id: newId(), text: str(a, "text") };
      return { ok: true, data: { columns: cols.map((c) => (c.id === col.id ? { ...c, cards: [...c.cards, card] } : c)) }, text: `Added [${card.id}] to ${col.name}.` };
    }
    case "kanban_move_card": {
      const hit = findCard(str(a, "card"));
      const to = colOf(str(a, "column"));
      if (!hit) return { ok: false, error: `no card "${str(a, "card")}" — use kanban_list` };
      if (!to) return { ok: false, error: `no column "${str(a, "column")}". Columns: ${names()}` };
      const without = cols.map((c) => ({ ...c, cards: c.cards.filter((k) => k.id !== hit.card.id) }));
      return {
        ok: true,
        data: { columns: without.map((c) => (c.id === to.id ? { ...c, cards: [...c.cards, hit.card] } : c)) },
        text: `Moved "${hit.card.text}" from ${hit.col.name} to ${to.name}.`,
      };
    }
    case "kanban_update_card": {
      const hit = findCard(str(a, "card"));
      if (!hit) return { ok: false, error: `no card "${str(a, "card")}" — use kanban_list` };
      const text = str(a, "text");
      return {
        ok: true,
        data: { columns: cols.map((c) => ({ ...c, cards: c.cards.map((k) => (k.id === hit.card.id ? { ...k, text } : k)) })) },
        text: `Updated [${hit.card.id}].`,
      };
    }
    case "kanban_delete_card": {
      const hit = findCard(str(a, "card"));
      if (!hit) return { ok: false, error: `no card "${str(a, "card")}" — use kanban_list` };
      return { ok: true, data: { columns: cols.map((c) => ({ ...c, cards: c.cards.filter((k) => k.id !== hit.card.id) })) }, text: `Deleted "${hit.card.text}".` };
    }
  }
  return { ok: false, error: `unknown kanban tool ${tool}` };
}

function checklist(items: ChecklistItem[], tool: string, a: Args, newId: () => string): OpResult<{ items: ChecklistItem[] }> {
  const it = () => pick(items, str(a, "item"), (x) => x.text);
  switch (tool) {
    case "checklist_list":
      return { ok: true, data: { items }, text: items.map((x) => `- [${x.done ? "x" : " "}] ${x.text} (${x.id})`).join("\n") || "(empty)" };
    case "checklist_add": {
      const item = { id: newId(), text: str(a, "text"), done: false };
      return { ok: true, data: { items: [...items, item] }, text: `Added (${item.id}).` };
    }
    case "checklist_toggle": {
      const x = it();
      if (!x) return { ok: false, error: `no item "${str(a, "item")}" — use checklist_list` };
      const done = typeof a.done === "boolean" ? a.done : true;
      return { ok: true, data: { items: items.map((y) => (y.id === x.id ? { ...y, done } : y)) }, text: `${done ? "Ticked" : "Unticked"} "${x.text}".` };
    }
    case "checklist_delete": {
      const x = it();
      if (!x) return { ok: false, error: `no item "${str(a, "item")}" — use checklist_list` };
      return { ok: true, data: { items: items.filter((y) => y.id !== x.id) }, text: `Deleted "${x.text}".` };
    }
  }
  return { ok: false, error: `unknown checklist tool ${tool}` };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const AGENT_EVENT_COLOR = "#8ea2ff";

function calendar<T extends { events: CalEvent[] }>(d: T, tool: string, a: Args, newId: () => string): OpResult<T> {
  const ev = () => pick(d.events, str(a, "event"), (x) => x.title);
  const badDate = (s: string) => (s && !DATE.test(s) ? `date must be YYYY-MM-DD (got "${s}")` : "");
  const badTime = (s: string) => (s && !TIME.test(s) ? `time must be HH:MM (got "${s}")` : "");
  switch (tool) {
    case "calendar_list": {
      const from = str(a, "from");
      const to = str(a, "to");
      const list = d.events
        .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
        .sort((x, y) => (x.date + (x.time ?? "")).localeCompare(y.date + (y.time ?? "")));
      return { ok: true, data: d, text: list.map((e) => `- ${e.date}${e.time ? ` ${e.time}` : ""} ${e.title} (${e.id})`).join("\n") || "(no events)" };
    }
    case "calendar_add_event": {
      const err = badDate(str(a, "date")) || badTime(str(a, "time"));
      if (err) return { ok: false, error: err };
      const e: CalEvent = { id: newId(), title: str(a, "title"), date: str(a, "date"), color: AGENT_EVENT_COLOR, ...(str(a, "time") ? { time: str(a, "time") } : {}) };
      return { ok: true, data: { ...d, events: [...d.events, e] }, text: `Added "${e.title}" on ${e.date}${e.time ? ` ${e.time}` : ""} (${e.id}).` };
    }
    case "calendar_update_event": {
      const x = ev();
      if (!x) return { ok: false, error: `no event "${str(a, "event")}" — use calendar_list` };
      const err = badDate(str(a, "date")) || badTime(str(a, "time"));
      if (err) return { ok: false, error: err };
      const next: CalEvent = { ...x, ...(str(a, "title") ? { title: str(a, "title") } : {}), ...(str(a, "date") ? { date: str(a, "date") } : {}), ...(str(a, "time") ? { time: str(a, "time") } : {}) };
      return { ok: true, data: { ...d, events: d.events.map((e) => (e.id === x.id ? next : e)) }, text: `Updated "${next.title}".` };
    }
    case "calendar_delete_event": {
      const x = ev();
      if (!x) return { ok: false, error: `no event "${str(a, "event")}" — use calendar_list` };
      return { ok: true, data: { ...d, events: d.events.filter((e) => e.id !== x.id) }, text: `Deleted "${x.title}".` };
    }
  }
  return { ok: false, error: `unknown calendar tool ${tool}` };
}

/** Apply one agent tool call to a tile; never mutates the input. */
export function applyTileOp(tile: Tile, tool: string, args: Args, newId: () => string): OpResult<Tile["data"]> {
  if (tile.kind === "kanban" && tool.startsWith("kanban_")) return kanban((tile as Tile<"kanban">).data.columns ?? [], tool, args, newId);
  if (tile.kind === "checklist" && tool.startsWith("checklist_")) return checklist((tile as Tile<"checklist">).data.items ?? [], tool, args, newId);
  if (tile.kind === "calendar" && tool.startsWith("calendar_")) return calendar((tile as Tile<"calendar">).data, tool, args, newId);
  return { ok: false, error: `${tool} does not apply to a ${tile.kind} tile` };
}

/** Toggle a link (console → tile). Returns the new link list. */
export function toggleLink(links: string[] | undefined, tileId: string): string[] {
  const cur = links ?? [];
  return cur.includes(tileId) ? cur.filter((x) => x !== tileId) : [...cur, tileId];
}

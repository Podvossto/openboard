import { describe, expect, it } from "vitest";
import type { KanbanCard, Tile } from "../../lib/types";
import { applyTileOp, isLinkable, toggleLink } from "./tileOps";

let n = 0;
const id = () => `n${++n}`;

const kanban: Tile<"kanban"> = {
  id: "k",
  kind: "kanban",
  title: "Sprint",
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  data: {
    columns: [
      { id: "todo", name: "To do", cards: [{ id: "c1", text: "fix login" }] },
      { id: "done", name: "Done", cards: [] },
    ],
  },
};
const checklist: Tile<"checklist"> = { ...kanban, id: "l", kind: "checklist", data: { items: [{ id: "i1", text: "write tests", done: false }] } };
const calendar: Tile<"calendar"> = { ...kanban, id: "c", kind: "calendar", data: { events: [], view: "month", cursor: "2026-10-01" } };

describe("kanban card metadata", () => {
  it("stamps creator / updater and lists details for the agent", () => {
    const k: Tile<"kanban"> = { ...kanban, data: { columns: [{ id: "todo", name: "Todo", cards: [] }] } };
    const a = applyTileOp(k, "kanban_add_card", { text: "Ship", description: "v0.1.4 release" }, () => "c9", { name: "builder", at: Date.UTC(2026, 9, 19, 10, 0) });
    if (!a.ok) throw new Error(a.error);
    const card = (a.data as { columns: { cards: KanbanCard[] }[] }).columns[0]!.cards[0]!;
    expect(card).toMatchObject({ text: "Ship", desc: "v0.1.4 release", createdBy: "builder", createdAt: Date.UTC(2026, 9, 19, 10, 0) });
    const k2 = { ...k, data: a.data } as Tile<"kanban">;
    const u = applyTileOp(k2, "kanban_update_card", { card: "c9", description: "now" }, () => "x", { name: "reviewer", at: 5 });
    if (!u.ok) throw new Error(u.error);
    const c2 = (u.data as { columns: { cards: KanbanCard[] }[] }).columns[0]!.cards[0]!;
    expect(c2).toMatchObject({ text: "Ship", desc: "now", updatedBy: "reviewer", updatedAt: 5, createdBy: "builder" });
    const l = applyTileOp({ ...k, data: u.data } as Tile<"kanban">, "kanban_list", {}, () => "x");
    expect(l.ok && l.text).toContain("by builder, created 2026-10-19 10:00");
    expect(l.ok && l.text).toContain("\n  now");
  });
});

describe("applyTileOp — kanban", () => {
  it("adds to the first column by default and to a named column", () => {
    const r = applyTileOp(kanban, "kanban_add_card", { text: "ship it" }, id);
    expect(r.ok && (r.data as typeof kanban.data).columns[0]!.cards.map((c) => c.text)).toEqual(["fix login", "ship it"]);
    const r2 = applyTileOp(kanban, "kanban_add_card", { text: "x", column: "done" }, id);
    expect(r2.ok && (r2.data as typeof kanban.data).columns[1]!.cards).toHaveLength(1);
    expect(kanban.data.columns[0]!.cards).toHaveLength(1); // input untouched
  });
  it("moves a card by text (case-insensitive) to a column by name", () => {
    const r = applyTileOp(kanban, "kanban_move_card", { card: "FIX LOGIN", column: "Done" }, id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cols = (r.data as typeof kanban.data).columns;
      expect(cols[0]!.cards).toHaveLength(0);
      expect(cols[1]!.cards[0]!.id).toBe("c1");
      expect(r.text).toContain("to Done");
    }
  });
  it("explains unknown cards / columns", () => {
    const r = applyTileOp(kanban, "kanban_move_card", { card: "nope", column: "Done" }, id);
    expect(!r.ok && r.error).toContain("no card");
    const r2 = applyTileOp(kanban, "kanban_add_card", { text: "a", column: "Later" }, id);
    expect(!r2.ok && r2.error).toContain("Columns: To do, Done");
  });
  it("updates, deletes and lists", () => {
    const u = applyTileOp(kanban, "kanban_update_card", { card: "c1", text: "fix SSO login" }, id);
    expect(u.ok && (u.data as typeof kanban.data).columns[0]!.cards[0]!.text).toBe("fix SSO login");
    const d = applyTileOp(kanban, "kanban_delete_card", { card: "c1" }, id);
    expect(d.ok && (d.data as typeof kanban.data).columns[0]!.cards).toHaveLength(0);
    const l = applyTileOp(kanban, "kanban_list", {}, id);
    expect(l.ok && l.text).toContain("## To do (todo)\n- [c1] fix login");
  });
});

describe("applyTileOp — checklist & calendar", () => {
  it("adds, toggles (default done) and deletes items", () => {
    const t = applyTileOp(checklist, "checklist_toggle", { item: "write tests" }, id);
    expect(t.ok && (t.data as typeof checklist.data).items[0]!.done).toBe(true);
    const u = applyTileOp(checklist, "checklist_toggle", { item: "i1", done: false }, id);
    expect(u.ok && (u.data as typeof checklist.data).items[0]!.done).toBe(false);
    const a = applyTileOp(checklist, "checklist_add", { text: "deploy" }, id);
    expect(a.ok && (a.data as typeof checklist.data).items).toHaveLength(2);
    expect(applyTileOp(checklist, "checklist_delete", { item: "zzz" }, id).ok).toBe(false);
  });
  it("adds events with validation and lists in order", () => {
    const bad = applyTileOp(calendar, "calendar_add_event", { title: "x", date: "20/10/2026" }, id);
    expect(!bad.ok && bad.error).toContain("YYYY-MM-DD");
    const badT = applyTileOp(calendar, "calendar_add_event", { title: "x", date: "2026-10-20", time: "25:00" }, id);
    expect(badT.ok).toBe(false);
    const a = applyTileOp(calendar, "calendar_add_event", { title: "Release", date: "2026-10-21", time: "09:30" }, id);
    expect(a.ok).toBe(true);
    const cal2 = { ...calendar, data: a.ok ? (a.data as typeof calendar.data) : calendar.data };
    const b = applyTileOp(cal2, "calendar_add_event", { title: "Standup", date: "2026-10-20" }, id);
    const cal3 = { ...calendar, data: b.ok ? (b.data as typeof calendar.data) : calendar.data };
    const l = applyTileOp(cal3, "calendar_list", { from: "2026-10-01" }, id);
    expect(l.ok && l.text.split("\n")[0]).toContain("Standup");
    const u = applyTileOp(cal3, "calendar_update_event", { event: "release", time: "10:00" }, id);
    expect(u.ok && (u.data as typeof calendar.data).events.find((e) => e.title === "Release")!.time).toBe("10:00");
  });
  it("rejects tools for the wrong tile kind", () => {
    expect(applyTileOp(checklist, "kanban_add_card", { text: "x" }, id).ok).toBe(false);
  });
});

describe("links", () => {
  it("toggleLink adds and removes", () => {
    expect(toggleLink(undefined, "t")).toEqual(["t"]);
    expect(toggleLink(["t", "u"], "t")).toEqual(["u"]);
  });
  it("isLinkable", () => {
    expect(isLinkable("kanban") && isLinkable("calendar") && !isLinkable("note")).toBe(true);
  });
});

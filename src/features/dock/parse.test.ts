import { describe, expect, it } from "vitest";
import { applySuggestion, findMentions, mentionAtCaret, mentionKey, parseCommand, suggest, type ParseCtx } from "./parse";

const ctx: ParseCtx = {
  consoles: [
    { id: "1", title: "api", running: true },
    { id: "2", title: "Web", running: true },
    { id: "3", title: "docs-1", group: "g", running: true },
    { id: "4", title: "docs-2", group: "g", running: false },
  ],
  groups: [{ id: "g", name: "Docs Team" }],
  focused: null,
};

describe("mentions", () => {
  it("finds @tokens but not e-mail addresses", () => {
    expect(findMentions("@a hi bob@x.com @b").map((m) => m.token)).toEqual(["a", "b"]);
  });
  it("mentionKey normalizes", () => expect(mentionKey(" Docs  Team ")).toBe("docs-team"));
});

describe("parseCommand send", () => {
  it("targets a console case-insensitively", () => {
    const r = parseCommand("@WEB run tests", ctx);
    expect(r).toMatchObject({ kind: "send", message: "run tests" });
    if (r.kind === "send") expect(r.targets.map((t) => t.id)).toEqual(["2"]);
  });
  it("@all hits only running consoles", () => {
    const r = parseCommand("@all stop", ctx);
    if (r.kind !== "send") throw new Error("expected send");
    expect(r.targets.map((t) => t.id)).toEqual(["1", "2", "3"]);
  });
  it("group mention reports skipped stopped members", () => {
    const r = parseCommand("@docs-team hello", ctx);
    if (r.kind !== "send") throw new Error("expected send");
    expect(r.targets.map((t) => t.id)).toEqual(["3"]);
    expect(r.skipped.map((t) => t.id)).toEqual(["4"]);
  });
  it("multiple targets are deduped", () => {
    const r = parseCommand("@api @api @web go", ctx);
    if (r.kind !== "send") throw new Error("expected send");
    expect(r.targets.map((t) => t.id)).toEqual(["1", "2"]);
  });
  it("keeps later @ in the message body", () => {
    const r = parseCommand("@api ask @web about it", ctx);
    if (r.kind !== "send") throw new Error("expected send");
    expect(r.message).toBe("ask @web about it");
  });
  it("routes plain text (no @) to the AI dispatcher", () => {
    expect(parseCommand("  pass this task to codex ", { ...ctx, focused: "1" })).toEqual({
      kind: "route",
      instruction: "pass this task to codex",
    });
  });
  it("errors without target, with unknown target, empty message", () => {
    expect(parseCommand("hello", { ...ctx, consoles: ctx.consoles.map((c) => ({ ...c, running: false })) }).kind).toBe("error");
    expect(parseCommand("@nope hi", ctx)).toEqual({ kind: "error", error: "Unknown target @nope" });
    expect(parseCommand("@api", ctx).kind).toBe("error");
    expect(parseCommand("   ", ctx).kind).toBe("error");
    expect(parseCommand("@docs-2 hi", ctx).kind).toBe("error");
  });
});

describe("parseCommand handoff", () => {
  it("resolves two consoles", () => {
    const r = parseCommand("/handoff @api @web", ctx);
    expect(r.kind).toBe("handoff");
    if (r.kind === "handoff") expect([r.from.id, r.to.id]).toEqual(["1", "2"]);
  });
  it("rejects bad usage", () => {
    expect(parseCommand("/handoff @api", ctx).kind).toBe("error");
    expect(parseCommand("/handoff @api @api", ctx).kind).toBe("error");
    expect(parseCommand("/handoff @api @docs-team", ctx).kind).toBe("error");
    expect(parseCommand("/handoff @api @docs-2", ctx).kind).toBe("error");
  });
});

describe("autocomplete", () => {
  it("detects the mention at the caret", () => {
    expect(mentionAtCaret("hi @we", 6)).toEqual({ start: 3, query: "we" });
    expect(mentionAtCaret("hi @we x", 8)).toBeNull();
    expect(mentionAtCaret("a@b", 3)).toBeNull();
  });
  it("suggests prefix matches first and includes all/groups", () => {
    expect(suggest("", ctx)[0]!.key).toBe("all");
    expect(suggest("do", ctx).map((s) => s.key)).toEqual(["docs-team", "docs-1", "docs-2"]);
    expect(suggest("eb", ctx).map((s) => s.key)).toEqual(["web"]);
  });
  it("applies a suggestion", () => {
    const s = suggest("we", ctx)[0]!;
    expect(applySuggestion("hi @we", 6, 3, s)).toEqual({ text: "hi @web ", caret: 8 });
  });
});

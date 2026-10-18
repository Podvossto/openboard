// Pure command-bar logic: @mention parsing, target resolution, autocomplete. No React, no IPC.

export interface CtxConsole {
  id: string;
  title: string;
  group?: string;
  running: boolean;
}
export interface CtxGroup {
  id: string;
  name: string;
}
export interface ParseCtx {
  consoles: CtxConsole[];
  groups: CtxGroup[];
  /** console with keyboard focus — default target when no @ is given */
  focused: string | null;
}

export type Parsed =
  | { kind: "send"; message: string; targets: CtxConsole[]; skipped: CtxConsole[] }
  | { kind: "handoff"; from: CtxConsole; to: CtxConsole }
  /** no @target: let the AI dispatcher decide (e.g. "pass this task to codex") */
  | { kind: "route"; instruction: string }
  | { kind: "error"; error: string };

/** "My Group" → "my-group" (what the user types after @) */
export const mentionKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

const MENTION = /@([^\s@]*)/g;

/** All @tokens (without the @) in order, with their offsets. */
export function findMentions(text: string): { token: string; start: number; end: number }[] {
  const out: { token: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(MENTION)) {
    // ignore e-mail-like "a@b"
    const prev = m.index > 0 ? text[m.index - 1]! : " ";
    if (!/\s/.test(prev)) continue;
    out.push({ token: m[1]!, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

type Resolved = { consoles: CtxConsole[]; label: string; isGroup: boolean };

/** Resolve one token to consoles. Consoles win over groups on a name clash. */
export function resolveToken(token: string, ctx: ParseCtx): Resolved | null {
  const key = token.toLowerCase();
  if (!key) return null;
  if (key === "all") return { consoles: ctx.consoles.filter((c) => c.running), label: "all", isGroup: true };
  const con = ctx.consoles.find((c) => mentionKey(c.title) === key);
  if (con) return { consoles: [con], label: con.title, isGroup: false };
  const grp = ctx.groups.find((g) => mentionKey(g.name) === key);
  if (grp) return { consoles: ctx.consoles.filter((c) => c.group === grp.id), label: grp.name, isGroup: true };
  return null;
}

export function parseCommand(input: string, ctx: ParseCtx): Parsed {
  const text = input.trim();
  if (!text) return { kind: "error", error: "Type a message first." };

  const hand = /^\/handoff(\s|$)/i.exec(text);
  if (hand) {
    const rest = text.slice(hand[0].length);
    const toks = findMentions(rest).map((m) => m.token);
    if (toks.length !== 2) return { kind: "error", error: "Usage: /handoff @from @to" };
    const [a, b] = toks.map((t) => resolveToken(t, ctx));
    if (!a || a.isGroup || a.consoles.length !== 1) return { kind: "error", error: `Unknown console @${toks[0]}` };
    if (!b || b.isGroup || b.consoles.length !== 1) return { kind: "error", error: `Unknown console @${toks[1]}` };
    const from = a.consoles[0]!;
    const to = b.consoles[0]!;
    if (from.id === to.id) return { kind: "error", error: "Pick two different consoles." };
    if (!from.running) return { kind: "error", error: `@${from.title} is not running.` };
    if (!to.running) return { kind: "error", error: `@${to.title} is not running.` };
    return { kind: "handoff", from, to };
  }

  // Leading run of @mentions are the targets; the rest is the message.
  const targets: CtxConsole[] = [];
  let pos = 0;
  let sawMention = false;
  for (;;) {
    const m = /^\s*@([^\s@]*)/.exec(text.slice(pos));
    if (!m) break;
    const r = resolveToken(m[1]!, ctx);
    if (!r) return { kind: "error", error: `Unknown target @${m[1]}` };
    sawMention = true;
    for (const c of r.consoles) if (!targets.some((t) => t.id === c.id)) targets.push(c);
    pos += m[0].length;
  }
  const message = text.slice(pos).trim();
  if (!message) return { kind: "error", error: sawMention ? "Add a message after the target." : "Type a message first." };

  if (!sawMention) {
    if (!ctx.consoles.some((c) => c.running)) return { kind: "error", error: "Nothing running to send to." };
    return { kind: "route", instruction: message };
  }
  const live = targets.filter((t) => t.running);
  const skipped = targets.filter((t) => !t.running);
  if (live.length === 0) return { kind: "error", error: skipped.length ? "Nothing running to send to." : "No consoles matched." };
  return { kind: "send", message, targets: live, skipped };
}

// ---------- autocomplete ----------

export interface Suggestion {
  key: string;
  label: string;
  kind: "console" | "group" | "all";
  hint: string;
}

/** The @query being typed at the caret, if any. */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

export function suggest(query: string, ctx: ParseCtx): Suggestion[] {
  const q = query.toLowerCase();
  const all: Suggestion[] = [
    { key: "all", label: "all", kind: "all", hint: `${ctx.consoles.filter((c) => c.running).length} running` },
    ...ctx.groups.map<Suggestion>((g) => ({
      key: mentionKey(g.name),
      label: g.name,
      kind: "group",
      hint: `${ctx.consoles.filter((c) => c.group === g.id).length} consoles`,
    })),
    ...ctx.consoles.map<Suggestion>((c) => ({
      key: mentionKey(c.title),
      label: c.title,
      kind: "console",
      hint: c.running ? "running" : "stopped",
    })),
  ];
  const starts = all.filter((s) => s.key.startsWith(q));
  const contains = all.filter((s) => !s.key.startsWith(q) && s.key.includes(q));
  return [...starts, ...contains].slice(0, 8);
}

/** Replace the @query at `start..caret` with the chosen suggestion + trailing space. */
export function applySuggestion(text: string, caret: number, start: number, s: Suggestion) {
  const insert = `@${s.key} `;
  const next = text.slice(0, start) + insert + text.slice(caret);
  return { text: next, caret: start + insert.length };
}

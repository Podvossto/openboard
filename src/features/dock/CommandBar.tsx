import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeWorkspace, useBoard } from "../../store/board";
import { ipc, submit } from "../../lib/ipc";
import { COMMAND_FOCUS_EVENT } from "./commandBus";
import { applySuggestion, mentionAtCaret, parseCommand, suggest, type ParseCtx } from "./parse";

type Result = { tone: "ok" | "warn" | "err"; text: string } | null;

function useParseCtx(): ParseCtx {
  const consoles = useBoard((s) => activeWorkspace(s.board).consoles);
  const groups = useBoard((s) => activeWorkspace(s.board).groups);
  const runtime = useBoard((s) => s.runtime);
  const focused = useBoard((s) => s.focused);
  return useMemo(
    () => ({
      consoles: consoles.map((c) => ({ id: c.id, title: c.title, group: c.group, running: !!runtime[c.id]?.running })),
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      focused,
    }),
    [consoles, groups, runtime, focused],
  );
}

export function CommandBar() {
  const ctx = useParseCtx();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [popDismissed, setPopDismissed] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const mention = popDismissed ? null : mentionAtCaret(text, caret);
  const options = useMemo(() => (mention ? suggest(mention.query, ctx) : []), [mention, ctx]);
  const popOpen = options.length > 0;

  const flash = useCallback((r: NonNullable<Result>) => {
    setResult(r);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(null), 5000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // "Broadcast" button on a group header
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent<string>).detail ?? "";
      setText(v);
      setCaret(v.length);
      setPopDismissed(true);
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(v.length, v.length);
      });
    };
    window.addEventListener(COMMAND_FOCUS_EVENT, on);
    return () => window.removeEventListener(COMMAND_FOCUS_EVENT, on);
  }, []);

  // auto-grow
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const pick = (i: number) => {
    const s = options[i];
    if (!s || !mention) return;
    const next = applySuggestion(text, caret, mention.start, s);
    setText(next.text);
    setCaret(next.caret);
    setSel(0);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = async () => {
    if (busy) return;
    const parsed = parseCommand(text, ctx);
    if (parsed.kind === "error") return flash({ tone: "err", text: parsed.error });
    try {
      if (parsed.kind === "handoff") {
        setBusy("Summarizing…");
        const brief = await ipc.handoffBrief(parsed.from.id, parsed.from.title, parsed.to.title);
        await submit(parsed.to.id, `Handoff from ${parsed.from.title}:\n${brief}`);
        flash({ tone: "ok", text: `Handed off ${parsed.from.title} → ${parsed.to.title}` });
      } else {
        await Promise.all(parsed.targets.map((t) => submit(t.id, parsed.message)));
        const n = parsed.targets.length;
        const skipped = parsed.skipped.length ? ` · skipped ${parsed.skipped.length} stopped` : "";
        flash({
          tone: parsed.skipped.length ? "warn" : "ok",
          text: `Sent to ${n} console${n === 1 ? "" : "s"}${skipped}`,
        });
      }
      setText("");
      setCaret(0);
    } catch (e) {
      flash({ tone: "err", text: `Failed: ${String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => (i + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (i - 1 + options.length) % options.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(Math.min(sel, options.length - 1)); return; }
      if (e.key === "Escape") { e.preventDefault(); setPopDismissed(true); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      setText("");
      setResult(null);
      ta.current?.blur();
    }
  };

  return (
    <div className="cmdbar">
      {popOpen && (
        <div className="menu cmd-pop" role="listbox" aria-label="Mentions">
          {options.map((o, i) => (
            <button
              key={`${o.kind}-${o.key}`}
              role="option"
              aria-selected={i === sel}
              className={`menu-item ${i === sel ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setSel(i)}
            >
              <span className={`cmd-kind ${o.kind}`}>{o.kind === "all" ? "@" : o.kind === "group" ? "▦" : "›_"}</span>
              {o.label}
              <span className="hint">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cmd-input-row">
        <textarea
          ref={ta}
          className="input cmd-input"
          rows={1}
          value={text}
          placeholder="Message an agent… @name, @all, @group  ·  /handoff @from @to"
          aria-label="Command bar"
          disabled={!!busy}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setSel(0);
            setPopDismissed(false);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <span className="pill working cmd-chip"><span className="dot" />{busy}</span>
        ) : (
          <button className="btn primary" disabled={!text.trim()} onClick={() => void send()} title="Send (Enter)">
            Send
          </button>
        )}
      </div>
      {result && <div className={`cmd-result ${result.tone}`} role="status">{result.text}</div>}
    </div>
  );
}

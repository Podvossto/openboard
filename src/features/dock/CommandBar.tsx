import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeWorkspace, useBoard } from "../../store/board";
import { ipc, submit } from "../../lib/ipc";
import { Orb } from "../../components/AgentIcon";
import { AnimatePresence, motion } from "motion/react";
import { popVariants } from "../../lib/motion";
import { COMMAND_FOCUS_EVENT } from "./commandBus";
import { applySuggestion, mentionAtCaret, parseCommand, suggest, type ParseCtx } from "./parse";
import { displayStatus } from "../../store/board";
import type { RoutePlan, RouterConsole } from "../../lib/types";

type Pending = { instruction: string; plan: Exclude<RoutePlan, { action: "none" }> };

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

/** Snapshot of the active workspace for the dispatcher (read at call time). */
function useRouterRoster(): () => RouterConsole[] {
  return useCallback(() => {
    const s = useBoard.getState();
    const ws = activeWorkspace(s.board);
    const groupName = (id?: string) => ws.groups.find((g) => g.id === id)?.name;
    return ws.consoles.map((c) => {
      const r = s.runtime[c.id];
      const kind = c.agent.kind;
      return {
        id: c.id,
        title: c.title,
        agent: kind === "claudeCode" ? "claude" : kind === "codex" ? "codex" : c.agent.program || "shell",
        status: r?.running ? displayStatus(r) : "exited",
        group: groupName(c.group),
        focused: s.focused === c.id,
      };
    });
  }, []);
}

export function CommandBar() {
  const ctx = useParseCtx();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [popDismissed, setPopDismissed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const roster = useRouterRoster();
  const titleOf = (id: string) => ctx.consoles.find((c) => c.id === id)?.title ?? id;
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

  const handoff = async (fromId: string, toId: string) => {
    const from = titleOf(fromId);
    const to = titleOf(toId);
    setBusy("Summarizing…");
    useBoard.getState().flash(fromId, toId, "handoff");
    const brief = await ipc.handoffBrief(fromId, from, to);
    await submit(toId, `Handoff from ${from}:\n${brief}`);
    flash({ tone: "ok", text: `Handed off ${from} → ${to}` });
  };

  const sendTo = async (ids: string[], message: string, skipped = 0) => {
    await Promise.all(ids.map((id) => submit(id, message)));
    const n = ids.length;
    flash({
      tone: skipped ? "warn" : "ok",
      text: `Sent to ${n} console${n === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped} stopped` : ""}`,
    });
  };

  const clear = () => {
    setText("");
    setCaret(0);
  };

  const runPending = async () => {
    if (!pending || busy) return;
    const { plan } = pending;
    try {
      if (plan.action === "handoff") await handoff(plan.from, plan.to);
      else await sendTo(plan.targets, plan.message);
      setPending(null);
      clear();
    } catch (e) {
      flash({ tone: "err", text: `Failed: ${String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (busy) return;
    if (pending) return void runPending();
    const parsed = parseCommand(text, ctx);
    if (parsed.kind === "error") return flash({ tone: "err", text: parsed.error });
    try {
      if (parsed.kind === "handoff") {
        await handoff(parsed.from.id, parsed.to.id);
        clear();
      } else if (parsed.kind === "send") {
        await sendTo(parsed.targets.map((t) => t.id), parsed.message, parsed.skipped.length);
        clear();
      } else {
        setBusy("Thinking…");
        const plan = await ipc.routeInstruction(parsed.instruction, roster());
        if (plan.action === "none") flash({ tone: "warn", text: plan.reason });
        else setPending({ instruction: parsed.instruction, plan });
      }
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
    if (pending && e.key === "Escape") {
      e.preventDefault();
      setPending(null);
      return;
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

  const insertAt = () => {
    const el = ta.current;
    const pos = el?.selectionStart ?? text.length;
    const pre = text.slice(0, pos);
    const add = pre && !/\s$/.test(pre) ? " @" : "@";
    const next = pre + add + text.slice(pos);
    setText(next);
    setCaret(pos + add.length);
    setPopDismissed(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + add.length, pos + add.length);
    });
  };

  return (
    <div className="relative w-full">
      <AnimatePresence>
      {pending && (
        <motion.div
          key="plan"
          variants={popVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{ transformOrigin: "bottom center" }}
          role="dialog"
          aria-label="Dispatch plan"
          className="glass absolute bottom-[calc(100%+10px)] left-0 right-0 z-30 rounded-2xl p-4"
        >
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Plan</div>
          {pending.plan.action === "handoff" ? (
            <div className="text-[14px] text-ink">
              Hand off <b>{titleOf(pending.plan.from)}</b> → <b>{titleOf(pending.plan.to)}</b>
              <span className="text-ink-3"> (summarise with Claude, then send the brief)</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-[14px] text-ink">
              <div className="flex flex-wrap items-center gap-1.5">
                Send to
                {pending.plan.targets.map((id) => (
                  <span key={id} className="rounded-full border border-line-strong bg-surface-3 px-2.5 py-0.5 text-[12.5px] font-semibold">
                    @{titleOf(id)}
                  </span>
                ))}
              </div>
              <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-bg/70 px-3 py-2 font-mono text-[12.5px] text-ink-2">
                {pending.plan.message}
              </div>
            </div>
          )}
          {pending.plan.reason && <div className="mt-2 text-[12px] text-ink-3">{pending.plan.reason}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button className="h-9 rounded-full px-4 text-[13px] font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              autoFocus
              className="h-9 rounded-full bg-ink px-4 text-[13px] font-semibold text-bg transition hover:bg-white active:scale-95"
              onClick={() => void runPending()}
            >
              Run ↵
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
      {popOpen && !pending && (
        <div role="listbox" aria-label="Mentions" className="glass animate-pop absolute bottom-[calc(100%+8px)] left-14 z-30 w-72 rounded-xl p-1.5">
          {options.map((o, i) => (
            <button
              key={`${o.kind}-${o.key}`}
              role="option"
              aria-selected={i === sel}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${i === sel ? "bg-surface-3 text-ink" : "text-ink-2"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span
                className={`grid size-5 place-items-center rounded-md font-mono text-[11px] ${
                  o.kind === "group" ? "bg-warn/15 text-warn" : o.kind === "all" ? "bg-accent/15 text-accent" : "bg-surface-3 text-ink-2"
                }`}
              >
                {o.kind === "all" ? "@" : o.kind === "group" ? "▦" : "›"}
              </span>
              <span className="font-medium">{o.label}</span>
              <span className="ml-auto text-[11px] text-ink-3">{o.hint}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-[60px] items-end gap-3 rounded-[22px] border border-line bg-surface-2/90 py-3 pl-3.5 pr-3 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.8)] backdrop-blur-xl transition focus-within:border-line-strong">
        <span className="self-center">
          <Orb busy={!!busy} />
        </span>
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={busy ?? "Tell the board what to do · @ to direct · /handoff @from @to"}
          aria-label="Command bar"
          disabled={!!busy}
          className="max-h-[120px] min-h-[24px] flex-1 resize-none self-center bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setSel(0);
            setPopDismissed(false);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="flex items-center gap-2 self-center">
          <button
            onClick={insertAt}
            title="Mention a console or group"
            aria-label="Mention"
            className="grid size-9 place-items-center rounded-full border border-line-strong text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95"
          >
            <span className="text-[15px] font-semibold">@</span>
          </button>
          <button
            onClick={() => void send()}
            disabled={!text.trim() || !!busy}
            title="Send (Enter)"
            aria-label="Send"
            className="grid size-9 place-items-center rounded-full bg-ink text-bg transition hover:bg-white active:scale-95 disabled:bg-surface-3 disabled:text-ink-3"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
            </svg>
          </button>
        </div>
      </div>

      {result && (
        <div
          role="status"
          className={`animate-rise absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[12px] ${
            result.tone === "ok" ? "bg-ok/12 text-ok" : result.tone === "warn" ? "bg-warn/12 text-warn" : "bg-danger/12 text-danger"
          }`}
        >
          {result.text}
        </div>
      )}
    </div>
  );
}

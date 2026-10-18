import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReactFlow } from "@xyflow/react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { fadeVariants, sheetVariants } from "../../lib/motion";
import { ipc } from "../../lib/ipc";
import type { FsEntry } from "../../lib/types";
import { activeWorkspace, useBoard } from "../../store/board";
import { addTile } from "../tiles/addTile";
import { CodeEditor } from "./CodeEditor";
import { baseName, fileColor, filterEntries, humanSize, isSafeRel, LANG_LABEL, langOf, parentDirs, pickRoot, rootLabel } from "./logic";
import "../settings/settings.css";

interface Tab {
  path: string;
  text: string;
  /** last saved text */
  saved: string;
  binary: boolean;
  truncated: boolean;
  loaded?: boolean;
  error?: string;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
    <path d="M3 1.5l4 3.5-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FileGlyph = ({ name, dir, open }: { name: string; dir: boolean; open?: boolean }) =>
  dir ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d={open ? "M3 8h18l-2 10H5zM3 8V6h6l2 2" : "M3 6h6l2 2h10v10H3z"} stroke="#8ea2ff" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M6 3h9l4 4v14H6zM15 3v4h4" stroke={fileColor(name)} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );

export function CodePanel({ onClose }: { onClose: () => void }) {
  const rf = useReactFlow();
  const target = useBoard.getState().ui.codeTarget;
  const [root, setRoot] = useState<string>(() => {
    if (target?.root) return target.root;
    const s = useBoard.getState();
    const ws = activeWorkspace(s.board);
    const focusedCwd = ws.consoles.find((c) => c.id === s.focused)?.cwd;
    return pickRoot(focusedCwd, s.settings.defaultCwd ?? "", s.resolvedCwd);
  });
  const [dirs, setDirs] = useState<Record<string, FsEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [note, setNote] = useState<string | null>(null);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const rootRef = useRef(root);
  rootRef.current = root;

  const loadDir = useCallback(async (rel: string, r = rootRef.current) => {
    try {
      const es = await ipc.fsList(r, rel);
      if (r !== rootRef.current) return;
      setDirs((d) => ({ ...d, [rel]: es }));
      if (rel === "") setTreeErr(null);
    } catch (e) {
      if (rel === "") setTreeErr(String(e));
    }
  }, []);

  const openFile = useCallback(async (path: string, r = rootRef.current) => {
    if (!isSafeRel(path)) return;
    setActive(path);
    if (tabsRef.current.some((t) => t.path === path)) return;
    const base: Tab = { path, text: "", saved: "", binary: false, truncated: false };
    setTabs((ts) => [...ts, base]);
    try {
      const c = await ipc.fsRead(r, path);
      setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, text: c.text, saved: c.text, binary: c.binary, truncated: c.truncated, loaded: true } : t)));
    } catch (e) {
      setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, error: String(e), loaded: true } : t)));
    }
  }, []);

  // (re)load the tree when the root changes
  useEffect(() => {
    setDirs({});
    setOpen(new Set());
    setTabs([]);
    setActive(null);
    setTreeErr(null);
    void loadDir("", root);
    const tg = useBoard.getState().ui.codeTarget;
    if (tg && tg.root === root && tg.path) {
      const parents = parentDirs(tg.path);
      setOpen(new Set(parents));
      for (const p of parents) void loadDir(p, root);
      void openFile(tg.path, root);
    }
    useBoard.getState().setUi({ codeTarget: null });
  }, [root, loadDir, openFile]);

  // a pinned tile double-clicked while the panel is already open
  const pendingTarget = useBoard((s) => s.ui.codeTarget);
  useEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.root !== rootRef.current) {
      // root effect consumes it
      setRoot(pendingTarget.root);
      return;
    }
    const parents = parentDirs(pendingTarget.path);
    setOpen((o) => new Set([...o, ...parents]));
    for (const p of parents) void loadDir(p);
    void openFile(pendingTarget.path);
    useBoard.getState().setUi({ codeTarget: null });
  }, [pendingTarget, loadDir, openFile]);

  const toggleDir = (path: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(path)) n.delete(path);
      else {
        n.add(path);
        if (!dirs[path]) void loadDir(path);
      }
      return n;
    });
  };

  const tab = tabs.find((t) => t.path === active);
  const dirty = (t: Tab) => !t.binary && !t.error && t.text !== t.saved;
  const anyDirty = tabs.some(dirty);

  const save = useCallback(async () => {
    const t = tabsRef.current.find((x) => x.path === active);
    if (!t || t.binary || t.truncated || t.error || t.text === t.saved) return;
    const text = t.text;
    try {
      await ipc.fsWrite(rootRef.current, t.path, text);
      setTabs((ts) => ts.map((x) => (x.path === t.path ? { ...x, saved: text } : x)));
      setNote(`Saved ${baseName(t.path)}`);
    } catch (e) {
      setNote(`Save failed: ${String(e)}`);
    }
  }, [active]);

  const closeTab = async (path: string) => {
    const t = tabsRef.current.find((x) => x.path === path);
    if (t && dirty(t) && !(await ask(`Discard unsaved changes to ${baseName(path)}?`, { title: "Unsaved changes" }))) return;
    const idx = tabsRef.current.findIndex((x) => x.path === path);
    const rest = tabsRef.current.filter((x) => x.path !== path);
    setTabs(rest);
    if (active === path) setActive(rest[Math.min(idx, rest.length - 1)]?.path ?? null);
  };

  const requestClose = useCallback(async () => {
    if (tabsRef.current.some(dirty) && !(await ask("Close Code studio and discard unsaved changes?", { title: "Unsaved changes" }))) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 2200);
    return () => window.clearTimeout(id);
  }, [note]);

  const pickRootDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false, defaultPath: root || undefined });
    if (typeof dir === "string" && dir !== root) {
      if (anyDirty && !(await ask("Switch folder and discard unsaved changes?", { title: "Unsaved changes" }))) return;
      setRoot(dir);
    }
  };

  const pin = async () => {
    if (!tab) return;
    await addTile("code", rf, { data: { root, path: tab.path }, title: baseName(tab.path) });
    setNote(`Pinned ${baseName(tab.path)} to the board`);
  };

  const renderDir = (rel: string, depth: number): React.ReactNode => {
    const es = dirs[rel];
    if (!es) return depth > 0 ? <div className="py-0.5 text-[11.5px] text-ink-3" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</div> : null;
    const shown = filterEntries(es, filter);
    return shown.map((e) => {
      const isOpen = open.has(e.path);
      return (
        <div key={e.path} role="none">
          <button
            role="treeitem"
            aria-label={e.name}
            aria-expanded={e.isDir ? isOpen : undefined}
            aria-selected={!e.isDir && active === e.path}
            className={`flex h-[26px] w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12.5px] transition hover:bg-surface-3 ${
              !e.isDir && active === e.path ? "bg-surface-3 text-ink" : "text-ink-2"
            }`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (e.isDir ? toggleDir(e.path) : void openFile(e.path))}
          >
            {e.isDir ? <Chevron open={isOpen} /> : <span className="w-[10px] shrink-0" />}
            <FileGlyph name={e.name} dir={e.isDir} open={isOpen} />
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
          </button>
          {e.isDir && isOpen && <div role="group">{renderDir(e.path, depth + 1)}</div>}
        </div>
      );
    });
  };

  const tree = useMemo(() => renderDir("", 0), [dirs, open, active, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div className="sheet-backdrop" variants={fadeVariants} initial="initial" animate="animate" exit="exit" onMouseDown={(e) => e.target === e.currentTarget && void requestClose()}>
      <motion.aside
        variants={sheetVariants}
        className="panel sheet !w-[min(1180px,calc(100vw-24px))]"
        role="dialog"
        aria-modal="true"
        aria-label="Code studio"
      >
        <header className="sheet-head">
          <h2>Code studio</h2>
          <button
            className="min-w-0 max-w-[40%] truncate rounded-full border border-line px-3 py-1 font-mono text-[12px] text-ink-2 transition hover:border-line-strong hover:text-ink"
            title={`${root} — click to change folder`}
            aria-label="Change folder"
            onClick={() => void pickRootDir()}
          >
            {rootLabel(root)}
          </button>
          <span className="flex-1" />
          {note && (
            <span className="saved show" role="status">
              {note}
            </span>
          )}
          <button className="btn ghost icon" onClick={() => void requestClose()} aria-label="Close code studio" title="Close (Esc)">
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-[260px] shrink-0 flex-col border-r border-line">
            <div className="p-2">
              <input
                className="h-8 w-full rounded-full border border-line bg-bg/70 px-3 text-[12.5px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/70"
                placeholder="Filter files…"
                aria-label="Filter files"
                spellCheck={false}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div role="tree" aria-label="Files" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
              {treeErr ? <div className="p-3 text-[12px] text-danger">{treeErr}</div> : tree}
              {!treeErr && dirs[""] && dirs[""].length === 0 && <div className="p-3 text-[12px] text-ink-3">Empty folder</div>}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2" role="tablist" aria-label="Open files">
              {tabs.map((t) => (
                <div
                  key={t.path}
                  className={`group/tab flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-3 pr-1.5 text-[12.5px] transition ${
                    active === t.path ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2"
                  }`}
                >
                  <button role="tab" aria-selected={active === t.path} aria-label={baseName(t.path)} title={t.path} className="flex items-center gap-1.5" onClick={() => setActive(t.path)}>
                    <FileGlyph name={t.path} dir={false} />
                    {baseName(t.path)}
                    {dirty(t) && <span className="size-1.5 rounded-full bg-warn" data-testid="dirty-dot" aria-label="unsaved changes" />}
                  </button>
                  <button
                    className="grid size-5 place-items-center rounded-full text-ink-3 hover:bg-surface-3 hover:text-ink"
                    aria-label={`Close ${baseName(t.path)}`}
                    onClick={() => void closeTab(t.path)}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
              <span className="flex-1" />
              {tab && !tab.binary && !tab.error && (
                <>
                  <button className="rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:opacity-40" disabled={!dirty(tab) || tab.truncated} onClick={() => void save()}>
                    Save
                  </button>
                  <button className="rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-ink-2 transition hover:bg-surface-3 hover:text-ink" onClick={() => void pin()}>
                    Pin to board
                  </button>
                </>
              )}
            </div>

            <div className="relative min-h-0 flex-1">
              {!tab ? (
                <div className="grid h-full place-items-center text-[13px] text-ink-3">Pick a file from the tree</div>
              ) : tab.error ? (
                <div className="grid h-full place-items-center px-8 text-center text-[13px] text-danger">{tab.error}</div>
              ) : !tab.loaded ? (
                <div className="grid h-full place-items-center text-[13px] text-ink-3">Loading…</div>
              ) : tab.binary ? (
                <div className="grid h-full place-items-center px-8 text-center text-[13px] text-ink-3">Binary file — can’t be shown.</div>
              ) : (
                <div className="flex h-full flex-col">
                  {tab.truncated && (
                    <div className="border-b border-line bg-warn/10 px-4 py-1.5 text-[12px] text-warn" role="status">
                      File is larger than 2 MB — showing the first part, read-only.
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <CodeEditor
                      docKey={tab.path}
                      value={tab.text}
                      lang={langOf(tab.path)}
                      readOnly={tab.truncated}
                      onChange={(text) => setTabs((ts) => ts.map((x) => (x.path === tab.path ? { ...x, text } : x)))}
                      onSave={() => void save()}
                      onCursor={(line, col) => setCursor({ line, col })}
                    />
                  </div>
                </div>
              )}
            </div>

            <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line px-4 text-[11.5px] text-ink-3" aria-label="Status bar">
              <span>{tab && !tab.binary && !tab.error ? LANG_LABEL[langOf(tab.path)] : "—"}</span>
              {tab && !tab.binary && !tab.error && (
                <span className="tabular-nums" aria-label="Cursor position">
                  Ln {cursor.line}, Col {cursor.col}
                </span>
              )}
              <span className="flex-1" />
              {tab && <span className="truncate font-mono">{tab.path}</span>}
              {tab?.loaded && !tab.binary && !tab.error && <span>{humanSize(new Blob([tab.text]).size)}</span>}
              <span>Ctrl+S save</span>
            </footer>
          </div>
        </div>
      </motion.aside>
    </motion.div>
  );
}

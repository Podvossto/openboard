import { lazy, Suspense, useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";
import { useBoard } from "../../store/board";
import type { Tile } from "../../lib/types";
import { langOf } from "../code/logic";

const CodeEditor = lazy(() => import("../code/CodeEditor"));

/** Pinned file: read-only highlighted preview. Double-click opens it in the Code studio. */
export function CodeTile({ tile }: { tile: Tile<"code"> }) {
  const { root, path } = tile.data;
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ipc
      .fsRead(root, path)
      .then((c) => {
        if (!live) return;
        setErr(c.binary ? "Binary file" : null);
        setText(c.text);
      })
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [root, path]);

  const openInStudio = () => useBoard.getState().setUi({ codeOpen: true, codeTarget: { root, path } });

  return (
    <div className="flex h-full flex-col text-[12.5px]" onDoubleClick={openInStudio} title="Double-click to open in Code studio">
      <div className="truncate border-b border-line px-3 py-1.5 font-mono text-[11.5px] text-ink-3" title={path}>
        {path || "No file"}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {err ? (
          <div className="grid h-full place-items-center px-4 text-center text-ink-3">{err}</div>
        ) : text === null ? (
          <div className="grid h-full place-items-center text-ink-3">Loading…</div>
        ) : (
          <Suspense fallback={<div className="grid h-full place-items-center text-ink-3">Loading…</div>}>
            <CodeEditor docKey={`${root}::${path}`} value={text} lang={langOf(path)} readOnly />
          </Suspense>
        )}
      </div>
    </div>
  );
}

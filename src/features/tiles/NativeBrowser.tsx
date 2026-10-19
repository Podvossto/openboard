import { useEffect, useRef, useState } from "react";
import { browserIpc, computeVisible, sameRect, type Rect } from "./browser";

/**
 * Hosts a native child WebView over this element. Each animation frame we measure the
 * element and push bounds only when they change; the webview is hidden whenever the tile
 * is partly off-stage or covered by DOM (menus, modals, other nodes), because a native view
 * always paints above the page.
 * `scale` = extra page zoom for device presets (CSS px of the device → on-screen px).
 */
export function NativeBrowser({
  tileId,
  url,
  nonce,
  scale = 1,
  onNav,
  onError,
}: {
  tileId: string;
  url: string;
  nonce: number;
  scale?: number;
  onNav: (url: string, loading: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const opened = useRef(false);
  const navRef = useRef(onNav);
  navRef.current = onNav;
  const errRef = useRef(onError);
  errRef.current = onError;

  // open once, then navigate on URL / reload-nonce changes
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    const zoom = canvasZoom() * scale;
    if (!opened.current) {
      opened.current = true;
      browserIpc
        .open(tileId, url, rect, zoom)
        .then(() => errRef.current(null))
        .catch((e) => errRef.current(String(e)));
    } else {
      browserIpc
        .navigate(tileId, url)
        .then(() => errRef.current(null))
        .catch((e) => errRef.current(String(e)));
    }
    // scale is applied by the bounds loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileId, url, nonce]);

  // close on unmount (tile removed / workspace switched)
  useEffect(() => () => void browserIpc.close(tileId).catch(() => undefined), [tileId]);

  // nav events → URL bar
  useEffect(() => {
    const off = browserIpc.onNav((p) => p.tile === tileId && navRef.current(p.url, p.loading));
    return () => void off.then((f) => f());
  }, [tileId]);

  // bounds follow the DOM (pan / zoom / drag / resize / overlays)
  useEffect(() => {
    let raf = 0;
    let last: Rect | null = null;
    let lastVis: boolean | null = null;
    let lastZoom = 0;
    const tick = () => {
      const el = host.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
        const s = document.querySelector(".react-flow")?.getBoundingClientRect();
        const stage = s ? { x: s.left, y: s.top, w: s.width, h: s.height } : null;
        const vis = computeVisible(el, stage, rect);
        const zoom = canvasZoom() * scale;
        if (vis !== lastVis || (vis && (!sameRect(rect, last) || Math.abs(zoom - lastZoom) > 0.001))) {
          last = rect;
          lastVis = vis;
          lastZoom = zoom;
          setVisible(vis);
          void browserIpc.setBounds(tileId, rect, zoom, vis).catch(() => undefined);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tileId, scale]);

  return (
    <div ref={host} data-native-browser={visible ? "shown" : "hidden"} className="relative h-full w-full bg-surface-2/40">
      {!visible && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-center text-[12px] text-ink-3">
          <span>
            Browser paused while covered or partly off-screen
            <br />
            <span className="font-mono text-[11px]">{url}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** Current React Flow zoom (the viewport transform's scale). */
function canvasZoom(): number {
  const vp = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!vp) return 1;
  const t = getComputedStyle(vp).transform;
  if (!t || t === "none") return 1;
  try {
    return new DOMMatrix(t).a || 1;
  } catch {
    return 1;
  }
}

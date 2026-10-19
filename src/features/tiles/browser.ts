// Native child-WebView placement for web tiles (pure parts are unit-tested in browser.test.ts).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Use the native webview (real browser, no X-Frame-Options limits) — only inside the real app.
 *  Headless tests can force it with `window.__nativeBrowser = true`. */
export function nativeBrowserAvailable(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __nativeBrowser?: boolean };
  if (w.__nativeBrowser !== undefined) return w.__nativeBrowser;
  return !!w.__TAURI_INTERNALS__ && import.meta.env.MODE !== "mock";
}

export const sameRect = (a: Rect | null, b: Rect | null, eps = 0.5) =>
  !!a && !!b && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.w - b.w) < eps && Math.abs(a.h - b.h) < eps;

/** a fully contains b (native views can't be clipped, so partial = hide) */
export const contains = (a: Rect, b: Rect) => b.x >= a.x - 0.5 && b.y >= a.y - 0.5 && b.x + b.w <= a.x + a.w + 0.5 && b.y + b.h <= a.y + a.h + 0.5;

/** Probe points (inset corners + centre) used to detect DOM drawn over the tile body. */
export function probePoints(r: Rect, inset = 4): [number, number][] {
  const l = r.x + inset, t = r.y + inset, rr = r.x + r.w - inset, b = r.y + r.h - inset;
  return [[l, t], [rr, t], [l, b], [rr, b], [r.x + r.w / 2, r.y + r.h / 2]];
}

/** Visible = fully inside the stage, big enough, and nothing (menu, modal, other node) covers it. */
export function computeVisible(body: HTMLElement, stage: Rect | null, r: Rect): boolean {
  if (r.w < 40 || r.h < 40) return false;
  if (stage && !contains(stage, r)) return false;
  if (document.visibilityState === "hidden") return false;
  return probePoints(r).every(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el && body.contains(el);
  });
}

export const browserIpc = {
  open: (tile: string, url: string, rect: Rect, zoom: number) => invoke<void>("browser_open", { tile, url, rect, zoom }),
  setBounds: (tile: string, rect: Rect, zoom: number, visible: boolean) =>
    invoke<void>("browser_set_bounds", { tile, rect, zoom, visible }),
  navigate: (tile: string, url: string) => invoke<void>("browser_navigate", { tile, url }),
  action: (tile: string, action: "back" | "forward" | "reload" | "stop") => invoke<void>("browser_action", { tile, action }),
  close: (tile: string) => invoke<void>("browser_close", { tile }),
  onNav: (cb: (p: { tile: string; url: string; loading: boolean }) => void): Promise<UnlistenFn> =>
    listen<{ tile: string; url: string; loading: boolean }>("browser://nav", (e) => cb(e.payload)),
};

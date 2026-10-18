#!/usr/bin/env python3
"""Layout audit (mock IPC): measures alignment/symmetry numerically + screenshots each surface."""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"

MEASURE = r"""
() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return {x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width/2, cy: b.y + b.height/2}; };
  const q = (s) => [...document.querySelectorAll(s)];
  const out = {};
  const vw = innerWidth, vh = innerHeight;
  out.viewport = {vw, vh};
  const top = document.querySelector('header, .topbar, [role=banner]');
  if (top) {
    out.topbar = r(top);
    out.topbarChildren = [...top.querySelectorAll('button, .ring-pill, [role=tab]')].filter(e => e.offsetParent).map(e => ({t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), ...r(e)}));
  }
  const rail = document.querySelector('nav.rail');
  if (rail) out.rail = {box: r(rail), btns: [...rail.querySelectorAll('button')].map(e => ({t: e.getAttribute('aria-label'), ...r(e)}))};
  const dock = document.querySelector('[role=toolbar][aria-label="Board dock"]');
  if (dock) out.dock = {box: r(dock), pills: [...dock.querySelectorAll('.ring-pill')].map(e => ({t: e.textContent.trim(), ...r(e)}))};
  const composer = document.querySelector('[aria-label="Command bar"]')?.closest('.relative')?.firstElementChild?.nextElementSibling || document.querySelector('[aria-label="Command bar"]')?.parentElement;
  if (composer) out.composer = r(composer);
  const flow = document.querySelector('.react-flow');
  if (flow) out.flow = r(flow);
  const zoom = document.querySelector('.zoom-control');
  if (zoom) out.zoom = r(zoom);
  const mini = document.querySelector('.react-flow__minimap');
  if (mini) out.minimap = r(mini);
  // console headers: vertical centering of children
  out.headers = q('.console-header').slice(0, 4).map(h => {
    const hb = h.getBoundingClientRect();
    return [...h.children].filter(c => c.offsetParent).map(c => { const b = c.getBoundingClientRect(); return {t: (c.textContent || c.getAttribute('aria-label') || c.tagName).trim().slice(0, 14), dy: +((b.y + b.height/2) - (hb.y + hb.height/2)).toFixed(1)}; });
  });
  // text centering inside pills/buttons: compare text box centre with element centre
  const off = [];
  for (const el of q('.ring-pill, [role=tab], .rail-btn, button.h-8, button.h-9')) {
    if (!el.offsetParent) continue;
    const b = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    const tb = range.getBoundingClientRect();
    if (!tb.width) continue;
    const dy = (tb.y + tb.height/2) - (b.y + b.height/2);
    const dx = (tb.x + tb.width/2) - (b.x + b.width/2);
    if (Math.abs(dy) > 1.5) off.push({t: el.textContent.trim().slice(0, 20) || el.getAttribute('aria-label'), dx: +dx.toFixed(1), dy: +dy.toFixed(1), h: b.height});
  }
  out.offCentre = off;
  // font families in use
  out.fonts = [...new Set(q('body *').filter(e => e.offsetParent && e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => getComputedStyle(e).fontFamily.split(',')[0]))];
  // radii on visible buttons
  out.radii = [...new Set(q('button').filter(e => e.offsetParent).map(e => getComputedStyle(e).borderTopLeftRadius))];
  out.heights = [...new Set(q('.ring-pill, [role=tab]').filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)))];
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for vw, vh, tag in [(1600, 950, "lg"), (1280, 760, "md")]:
        pg = b.new_page(viewport={"width": vw, "height": vh})
        pg.goto(URL)
        pg.wait_for_selector(".ring-pill")
        pg.wait_for_timeout(1200)
        m = pg.evaluate(MEASURE)
        json.dump(m, open(f"/tmp/ab-audit-{tag}.json", "w"), indent=1)
        pg.screenshot(path=f"/tmp/ab-audit-{tag}.png")
        if tag == "lg":
            pg.locator("button[aria-label='Settings']").first.click()
            pg.wait_for_timeout(500)
            pg.screenshot(path="/tmp/ab-audit-settings.png")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
            pg.get_by_role("button", name="Spawn 4").click()
            pg.wait_for_timeout(400)
            pg.screenshot(path="/tmp/ab-audit-compose.png")
            pg.keyboard.press("Escape")
            pg.locator(".console").first.get_by_role("button", name="More").click()
            pg.wait_for_timeout(300)
            pg.screenshot(path="/tmp/ab-audit-menu.png")
        pg.close()
    b.close()
print("ok")

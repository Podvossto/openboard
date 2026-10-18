#!/usr/bin/env python3
"""Motion smoke (mock IPC): verifies animations actually run and stay out of the way.
- console enter animates (opacity/scale change over time)
- drag is 1:1 (no transition lag while dragging)
- group layout glide (programmatic move animates)
- remove plays exit then node is gone
- status chip morphs label
- lead edge appears and becomes active (particles) on send
- terminal text crisp: xterm font scales with zoom, PTY grid unchanged
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(1500)

    # ---- drag is 1:1
    node = pg.locator(".react-flow__node[data-id='c1']")
    bb = node.locator(".console-header").bounding_box()
    pg.mouse.move(bb["x"] + 80, bb["y"] + 15)
    pg.mouse.down()
    pg.mouse.move(bb["x"] + 100, bb["y"] + 15, steps=2)  # past the drag threshold
    pg.wait_for_timeout(30)
    x0 = node.bounding_box()["x"]
    pg.mouse.move(bb["x"] + 200, bb["y"] + 15, steps=5)
    pg.wait_for_timeout(16)
    dx = node.bounding_box()["x"] - x0
    pg.mouse.up()
    zoom = pg.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a")
    check(abs(dx - 100) < 3, f"drag tracks cursor 1:1 (moved {dx:.1f}px for 100px)")

    # ---- enter animation of a new console
    n0 = pg.locator(".console").count()
    pg.get_by_role("button", name="New console").click()
    pg.wait_for_timeout(40)
    early = pg.evaluate("(() => { const cs=[...document.querySelectorAll('.console')]; const c=cs[cs.length-1]; return +getComputedStyle(c).opacity })()")
    pg.wait_for_timeout(700)
    late = pg.evaluate("(() => { const cs=[...document.querySelectorAll('.console')]; const c=cs[cs.length-1]; return +getComputedStyle(c).opacity })()")
    check(pg.locator(".console").count() == n0 + 1 and early < 0.95 and late > 0.99, f"new console fades/scales in ({early:.2f} → {late:.2f})")

    # ---- status chip morph
    pg.evaluate("window.__mock.emit('console://status', {id: 'c3', status: 'resting'})")
    pg.wait_for_timeout(500)
    chip = pg.locator(".react-flow__node[data-id='c3'] .status-chip")
    check("ready" in chip.inner_text().lower(), f"status chip morphs to READY ({chip.inner_text()!r})")

    # ---- crisp text: font scales with zoom, grid stays
    pg.wait_for_timeout(400)
    zoom = pg.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a")
    fs = pg.evaluate("getComputedStyle(document.querySelector('.react-flow__node[data-id=\"c1\"] .xterm-rows')).fontSize")
    check(abs(float(fs[:-2]) - round(13 * zoom * 4) / 4) < 0.01, f"xterm rasterised at font×zoom ({fs} @ zoom {zoom})")
    resizes_before = len([e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "resize_console"])
    pg.get_by_role("button", name="Zoom in").click()
    pg.wait_for_timeout(700)
    resizes_after = len([e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "resize_console"])
    fs2 = pg.evaluate("getComputedStyle(document.querySelector('.react-flow__node[data-id=\"c1\"] .xterm-rows')).fontSize")
    check(fs2 != fs and resizes_after == resizes_before, f"zoom re-rasterises ({fs}→{fs2}) without resizing the PTY ({resizes_before}→{resizes_after})")

    # ---- lead edge + active particles
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    api = pg.locator(".react-flow__node[data-id='c1'] .console")
    api.get_by_role("button", name="More").dispatch_event("click")
    api.get_by_role("menuitemcheckbox", name="Make orchestrator lead").dispatch_event("click")
    pg.wait_for_timeout(300)
    pg.evaluate("window.__mock.emit('orchestrator://sent', {from: 'c1', to: 'c3'})")
    pg.wait_for_timeout(500)
    check(pg.locator(".flow-edge[data-kind='lead']").count() == 1, "lead → worker edge drawn")
    check(pg.locator(".flow-edge[data-active] circle").count() == 3, "edge active with travelling particles")
    pg.screenshot(path="/tmp/ab-motion-edge.png")
    pg.wait_for_timeout(6500)
    check(pg.locator(".flow-edge[data-active]").count() == 0 and pg.locator(".flow-edge").count() == 1, "edge calms down after send, stays as link")

    # ---- remove plays exit then disappears
    last = pg.locator(".react-flow__node[data-id='c4'] .console")
    last.get_by_role("button", name="More").dispatch_event("click")
    pg.wait_for_timeout(200)
    n1 = pg.locator(".console").count()
    last.get_by_role("menuitem", name="Remove from board").dispatch_event("click")
    # sample opacity every animation frame until the node unmounts; record the minimum seen while mounted
    op, mid = pg.evaluate("""() => new Promise((res) => {
      let min = 1, frames = 0, mounted = 0;
      const tick = () => {
        const e = document.querySelector(".react-flow__node[data-id='c4'] .console");
        if (e) { min = Math.min(min, +getComputedStyle(e).opacity); mounted++; }
        if (!e || ++frames > 600) return res([min, mounted]);
        requestAnimationFrame(tick);
      };
      tick();
    })""")
    mid = n1 if mid > 1 else -1
    pg.wait_for_timeout(500)
    check(mid == n1 and 0 <= op < 0.95 and pg.locator(".console").count() == n1 - 1, f"remove plays exit before unmount (min opacity {op:.2f} while mounted, then {pg.locator('.console').count()} left)")

    # ---- badge exit with a real clock: start a loop on c1, then stop it
    c1 = pg.locator(".react-flow__node[data-id='c1'] .console")
    c1.get_by_role("button", name="More").dispatch_event("click")
    c1.get_by_role("menuitem", name="Loop…").dispatch_event("click")
    dlg = c1.get_by_role("dialog", name="Loop")
    dlg.locator("textarea").fill("continue")
    dlg.get_by_role("button", name="Start loop").dispatch_event("click")
    pg.wait_for_timeout(500)
    had = c1.get_by_label("Loop running").count()
    c1.get_by_role("button", name="More").dispatch_event("click")
    c1.get_by_role("menuitem", name="Loop (running)…").dispatch_event("click")
    c1.get_by_role("dialog", name="Loop").get_by_role("button", name="Stop loop").dispatch_event("click")
    pg.wait_for_timeout(600)
    check(had == 1 and c1.get_by_label("Loop running").count() == 0, "loop badge animates in and out")

    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

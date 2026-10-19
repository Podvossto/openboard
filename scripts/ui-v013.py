#!/usr/bin/env python3
"""v0.1.3 (mock IPC): drag a console's link knob onto a kanban → link edge + roster links,
simulated agent tool calls (tile://op) add/move cards live, unlinked tiles are refused,
Orchestrator HUD shows the agent + tile, right-click edge → unlink. Hover dot glow visible."""
import io
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5316/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


OP = """([opId, from, tile, tool, args]) => { window.__mock.emit('tile://op', { opId, from, tile, tool, args }); }"""
RESULT = """(opId) => (window.__tileResults || []).find(r => r.opId === opId) || null"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = false")

    # add a kanban tile via the radial menu (right-click empty canvas)
    pane = pg.locator(".react-flow__pane").bounding_box()
    pg.mouse.click(pane["x"] + pane["width"] - 260, pane["y"] + pane["height"] - 220, button="right")
    pg.get_by_role("menuitem", name="Kanban").click() if pg.get_by_role("menuitem", name="Kanban").count() else pg.get_by_role("button", name="Kanban").first.click()
    kb = pg.locator(".tile[data-kind=kanban]").first
    kb.wait_for(timeout=4000)
    pg.wait_for_timeout(500)
    tile_id = pg.evaluate("() => { const s = window.__store?.getState?.(); return null }")
    tid = kb.evaluate("el => el.closest('.react-flow__node').getAttribute('data-id')")
    check(bool(tid), f"kanban tile on the board ({tid})")

    # fit everything on screen, then drag console c1's link knob onto the kanban
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    con = pg.locator(".react-flow__node[data-id=c1]")
    con.hover()
    knob = con.locator(".console-link-handle")
    check(knob.count() == 1, "console has a link knob")
    kbox = kb.bounding_box()
    hb = knob.bounding_box()
    pg.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(kbox["x"] + kbox["width"] / 2, kbox["y"] + kbox["height"] / 2, steps=15)
    pg.mouse.up()
    pg.wait_for_timeout(400)
    # c1 is running in the mock → restart offer
    dlg = pg.get_by_role("dialog", name="Restart agent")
    if dlg.count():
        check("Linked kanban" in dlg.inner_text(), "restart offer names the linked tile")
        dlg.get_by_role("button", name="Later").click()
        pg.wait_for_timeout(300)
    edge = pg.locator(f".react-flow__edge[data-id='link:c1->{tid}'], [data-testid='rf__edge-link:c1->{tid}']")
    check(edge.count() == 1, "link edge drawn console → kanban")
    roster = pg.evaluate("window.__roster")
    me = next((r for r in roster if r["id"] == "c1"), {})
    check(any(l["id"] == tid and l["kind"] == "kanban" for l in me.get("links", [])), "roster tells the backend about the link")

    # simulated agent tool calls
    pg.evaluate(OP, ["op1", "c1", tid, "kanban_add_card", {"tile": "Kanban", "text": "fix login"}])
    pg.wait_for_timeout(300)
    r1 = pg.evaluate(RESULT, "op1")
    check(r1 is not None and r1.get("error") is None and "Added" in (r1.get("text") or ""), f"agent add_card answered ({r1})")
    check(kb.get_by_text("fix login").count() == 1, "card appears on the kanban live")
    cols = kb.evaluate("el => [...el.querySelectorAll('[data-column], .kanban-col, section')].length")
    last_col = pg.evaluate(f"""() => {{ const s = JSON.stringify(window.__ipcLog.filter(e=>e.cmd==='save_board').slice(-1)[0]?.args || {{}}); return s.includes('fix login'); }}""")
    pg.wait_for_timeout(1500)
    saved = pg.evaluate("() => window.__ipcLog.filter(e=>e.cmd==='save_board').some(e=>JSON.stringify(e.args).includes('fix login'))")
    check(saved, "agent edit is autosaved like a manual edit")

    pg.evaluate(OP, ["op2", "c1", tid, "kanban_move_card", {"tile": "Kanban", "card": "fix login", "column": "Done"}])
    pg.wait_for_timeout(300)
    r2 = pg.evaluate(RESULT, "op2")
    check(r2 and "to Done" in (r2.get("text") or ""), f"agent move_card answered ({r2})")

    pg.evaluate(OP, ["op3", "c1", tid, "kanban_move_card", {"tile": "Kanban", "card": "nope", "column": "Done"}])
    pg.wait_for_timeout(300)
    r3 = pg.evaluate(RESULT, "op3")
    check(r3 and "no card" in (r3.get("error") or ""), "bad card → helpful error for the agent")

    # a console that is NOT linked is refused
    pg.evaluate(OP, ["op4", "c3", tid, "kanban_add_card", {"tile": "Kanban", "text": "sneaky"}])
    pg.wait_for_timeout(300)
    r4 = pg.evaluate(RESULT, "op4")
    check(r4 and r4.get("error") and kb.get_by_text("sneaky").count() == 0, "unlinked console is refused")

    # HUD
    hud = pg.get_by_role("region", name="Orchestrator")
    check(hud.count() == 1, "Orchestrator HUD visible")
    check(hud.locator(f"[data-hud-tile='{tid}']").count() == 1 and "2×" in hud.locator(f"[data-hud-tile='{tid}']").inner_text(), "HUD shows the linked tile with 2 agent edits")
    pg.get_by_role("button", name="Orchestrator HUD").click()
    pg.wait_for_timeout(300)
    check(pg.get_by_role("region", name="Orchestrator").count() == 0, "HUD collapses")
    pg.get_by_role("button", name="Orchestrator HUD").click()

    # spawn passes links (kind, title) so the agent gets the tools
    pg.evaluate("window.__ipcLog.length = 0")
    pg.evaluate("() => window.__TAURI_INTERNALS__")  # noop
    # unlink via right-click on a VISIBLE part of the edge (nodes may cover its middle)
    g = pg.locator(f"[data-testid='rf__edge-link:c1->{tid}']")
    pt = g.evaluate("""e => { const p = e.querySelector('path.react-flow__edge-interaction'); const L = p.getTotalLength(); const ctm = p.getScreenCTM();
        for (let i = 1; i < 40; i++) { const m = p.getPointAtLength(L * i / 40); const x = m.x * ctm.a + ctm.e, y = m.y * ctm.d + ctm.f;
          const el = document.elementFromPoint(x, y); if (el && el.closest('.react-flow__edge') === e) return [x, y]; }
        return null; }""")
    check(pt is not None, "link edge is reachable somewhere for a right-click")
    if pt:
        pg.mouse.click(pt[0], pt[1], button="right")
        d = pg.get_by_role("dialog", name="Unlink tile")
        d.wait_for(timeout=3000)
        check("Unlink" in d.inner_text(), "right-click edge asks to unlink")
        d.get_by_role("button", name="Cancel").click()
        pg.wait_for_timeout(300)
    # unlink from the HUD
    pg.get_by_role("button", name=f"Unlink Kanban from api").click()
    d = pg.get_by_role("dialog", name="Unlink tile")
    d.wait_for(timeout=3000)
    d.get_by_role("button", name="Unlink").click()
    pg.wait_for_timeout(300)
    r = pg.get_by_role("dialog", name="Restart agent")
    if r.count():
        r.get_by_role("button", name="Later").click()
    pg.wait_for_timeout(400)
    check(pg.locator(f"[data-testid='rf__edge-link:c1->{tid}']").count() == 0, "HUD Unlink removes the link edge")

    # hover glow
    from PIL import Image
    # an empty spot: top-right of the canvas (minimap is bottom-left, HUD bottom-right)
    if pg.get_by_role("button", name="Orchestrator HUD").count():
        pg.get_by_role("button", name="Orchestrator HUD").click()
    x, y = int(pane["x"] + pane["width"] - 120), int(pane["y"] + 90)
    pg.mouse.move(5, 5)
    pg.wait_for_timeout(350)
    a = Image.open(io.BytesIO(pg.screenshot(clip={"x": x - 40, "y": y - 40, "width": 80, "height": 80}))).convert("L")
    pg.mouse.move(x, y)
    pg.wait_for_timeout(350)
    c = Image.open(io.BytesIO(pg.screenshot(clip={"x": x - 40, "y": y - 40, "width": 80, "height": 80}))).convert("L")
    check(max(c.get_flattened_data()) > max(a.get_flattened_data()) + 40, f"dots brighten under the cursor ({max(a.get_flattened_data())} → {max(c.get_flattened_data())})")
    pg.screenshot(path="/tmp/ab-v013.png")

    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

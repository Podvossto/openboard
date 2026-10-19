#!/usr/bin/env python3
"""v0.1.4 (mock IPC) — feedback items 1-11, 13 (item 12 has its own ui-skills-unified):
 4 selected group doesn't block other tiles · 5 wheel zooms · 7 right-click in group → radial
 menu, tile lands in the group · 9 usage pill shows the error · 11 agent picker searchable, no
 CLI-args field · 13 needs-you inbox → click focuses · 8+6 console→console link = lead + team
 in HUD · 1 kanban card detail (who/when, edit) · 10 dropped image → image tile ·
 2 memory auto-share + snippet → spawn gets extraPrompt · 3 preset editor → sidebar → spawn."""
import base64
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5318/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def _png(w=40, h=24):
    import struct, zlib
    raw = b"".join(b"\x00" + bytes([200, 80, 40, 255]) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PNG = base64.b64encode(_png()).decode()

SPAWNS = "() => (window.__spawns || []).map(a => ({ id: a.id, prompt: a.extraPrompt || '', mcp: a.extraMcp || [], lead: !!a.lead, title: a.title }))"


def radial_add(pg, x, y, name):
    pg.mouse.click(x, y, button="right")
    pg.wait_for_timeout(250)
    pg.get_by_role("menuitem", name=f"+ {name}").first.click()
    pg.wait_for_timeout(500)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.__usageErr = 'login expired — open any Claude console once to refresh it'")
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = true")

    # ---- 9: usage pill still visible with the reason
    pill = pg.locator("[data-usage-error=true]")
    pg.wait_for_timeout(800)
    check(pill.count() == 1 and "login expired" in pill.inner_text(), "9 usage pill shows the error reason")

    # ---- 5: wheel over empty canvas zooms (no Ctrl)
    pane = pg.locator(".react-flow__pane").bounding_box()
    zoom = "() => { const t = document.querySelector('.react-flow__viewport').style.transform; const m = /scale\\(([^)]+)\\)/.exec(t); return m ? parseFloat(m[1]) : 1 }"
    z0 = pg.evaluate(zoom)
    pg.mouse.move(pane["x"] + pane["width"] - 120, pane["y"] + 120)
    pg.mouse.wheel(0, -400)
    pg.wait_for_timeout(500)
    z1 = pg.evaluate(zoom)
    check(z1 > z0 * 1.05, f"5 wheel zooms in without Ctrl ({z0:.2f} → {z1:.2f})")
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(500)

    # ---- 7: right-click inside the group body → radial menu → note lands in the group
    g = pg.locator(".react-flow__node-group").first
    gb = g.bounding_box()
    gid = g.get_attribute("data-id")
    pg.mouse.click(gb["x"] + gb["width"] - 60, gb["y"] + gb["height"] - 40, button="right")
    pg.wait_for_timeout(300)
    check(pg.get_by_role("menuitem", name="+ Note").count() == 1, "7 right-click inside a group opens the radial menu")
    pg.get_by_role("menuitem", name="+ Note").click()
    pg.wait_for_timeout(1300)  # autosave debounce
    grouped = pg.evaluate("""(gid) => { const b = window.__savedBoard; if (!b) return null;
      const ws = b.workspaces.find(w => w.id === b.active); const t = (ws.tiles || []).filter(t => t.kind === 'note').pop();
      return t ? t.group : null }""", gid)
    check(grouped == gid, f"7 tile added from the group's menu joins the group ({grouped})")
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    gb = g.bounding_box()

    # ---- 4: with the group selected, a tile on top is still clickable
    hb = g.locator(".group-header").bounding_box()
    pg.mouse.click(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
    pg.wait_for_timeout(250)
    z = g.evaluate("e => getComputedStyle(e).zIndex")
    ta = pg.locator(".tile[data-kind=note] textarea").last
    bb = ta.bounding_box()
    top = pg.evaluate(f"(() => {{ const e = document.elementFromPoint({bb['x'] + bb['width'] / 2}, {bb['y'] + bb['height'] / 2}); return e && e.tagName }})()")
    check(top == "TEXTAREA" and z != "1000", f"4 selected group stays below its tiles (z={z}, top={top})")
    ta.click()
    pg.keyboard.type("hello")
    check("hello" in ta.input_value(), "4 typing into a tile works while the group was selected")

    # ---- 13: needs-you inbox
    pg.evaluate("window.__mock.emit('console://status', { id: 'c3', status: 'needsYou' })")
    pg.wait_for_timeout(600)
    item = pg.locator("[data-needs=c3]")
    check(item.count() == 1, "13 needs-you item appears top-right")
    if item.count():
        pg.get_by_role("button", name="Fit view").click()
        pg.wait_for_timeout(200)
        item.click()
        pg.wait_for_timeout(700)
        focused = pg.evaluate("() => !!document.querySelector('.react-flow__node[data-id=c3] .console.focused, .react-flow__node[data-id=c3].focused, .react-flow__node[data-id=c3] [data-focused=true]')")
        c3 = pg.locator(".react-flow__node[data-id=c3]").bounding_box()
        vp = pg.viewport_size
        centred = c3 and abs((c3["x"] + c3["width"] / 2) - vp["width"] / 2) < 260
        check(centred, "13 clicking the item flies to that console")
    pg.evaluate("window.__mock.emit('console://status', { id: 'c3', status: 'working' })")
    pg.wait_for_timeout(600)
    check(pg.locator("[data-needs=c3]").count() == 0, "13 item disappears once the agent continues")
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(500)

    # ---- 8 + 6: drag c1's knob onto c2 → c1 becomes lead; HUD shows the team
    c1 = pg.locator(".react-flow__node[data-id=c1]")
    c2 = pg.locator(".react-flow__node[data-id=c2]")
    if c2.count() == 0:
        c2 = pg.locator(".react-flow__node[data-id=c4]")
    tgt = c2.get_attribute("data-id")
    c1.hover()
    knob = c1.locator(".console-link-handle").bounding_box()
    t = c2.bounding_box()
    pg.mouse.move(knob["x"] + knob["width"] / 2, knob["y"] + knob["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(t["x"] + t["width"] / 2, t["y"] + 60, steps=15)
    pg.mouse.up()
    pg.wait_for_timeout(700)
    check(pg.locator(f".react-flow__edge[data-id='team:c1->{tgt}'], [data-testid='rf__edge-team:c1->{tgt}']").count() >= 1, f"8 console→console drag draws a team line (c1→{tgt})")
    hud = pg.get_by_role("region", name="Orchestrator")
    check(hud.count() == 1 and pg.locator(f"[data-hud-worker={tgt}]").count() >= 1, "6 HUD lists the new teammate under the lead")
    team = pg.locator("[data-hud-team]").first
    check(team.count() == 1 and len(team.get_attribute("data-hud-team") or "") > 0, f"6 HUD shows a team name ({team.get_attribute('data-hud-team') if team.count() else '-'})")

    # ---- 11: default agent picker (Settings → General)
    pg.get_by_role("button", name="Settings").first.click()
    pg.wait_for_timeout(500)
    picker = pg.get_by_role("button", name="Default agent for new consoles: Claude Code")
    check(picker.count() == 1, "11 default agent is a dropdown")
    if picker.count():
        picker.click()
        pg.get_by_role("textbox", name="Search agents").fill("qwen")
        opts = pg.get_by_role("option")
        check(opts.count() == 1 and "Qwen" in opts.first.inner_text(), "11 search filters agents (qwen)")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(300)
        check(pg.get_by_role("button", name="Default agent for new consoles: Qwen Code").count() == 1, "11 picking an agent updates the default")
    pg.get_by_role("tab", name="Agents").click() if pg.get_by_role("tab", name="Agents").count() else None
    pg.wait_for_timeout(300)
    check(pg.get_by_text("Default CLI arguments").count() == 0, "11 no 'Default CLI arguments' field")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(500)

    # ---- 1: kanban card detail
    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(400)
    radial_add(pg, pane["x"] + pane["width"] - 140, pane["y"] + 140, "Kanban")
    kb = pg.locator(".tile[data-kind=kanban]").last
    kb.scroll_into_view_if_needed()
    add = kb.get_by_role("textbox", name="New card").first
    add.fill("Write release notes")
    add.press("Enter")
    pg.wait_for_timeout(300)
    card = kb.get_by_role("button", name="Open card Write release notes")
    check(card.count() == 1, "1 card added")
    card.click()
    dlg = pg.get_by_role("dialog", name="Card details")
    check(dlg.count() == 1, "1 clicking a card opens its details")
    if dlg.count():
        meta = dlg.get_by_test_id("card-meta").inner_text()
        check("by you" in meta and "Created" in meta, "1 details show created by/when")
        dlg.get_by_role("textbox", name="Card title").fill("Write v0.1.4 notes")
        dlg.locator("#card-desc").fill("Include the 13 items")
        dlg.get_by_role("button", name="Done").click()
        pg.wait_for_timeout(400)
        c = kb.get_by_role("button", name="Open card Write v0.1.4 notes")
        check(c.count() == 1, "1 edited title saved")
        c.click()
        meta2 = pg.get_by_role("dialog", name="Card details").get_by_test_id("card-meta").inner_text()
        check("Last edit" in meta2 and "never" not in meta2.split("Last edit")[1].split("Id")[0], "1 last edit stamped")
        check(pg.locator("#card-desc").input_value() == "Include the 13 items", "1 details saved")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)

    # ---- 10: drop an image file → image tile
    n_img = pg.locator(".tile[data-kind=image]").count()
    pg.evaluate("""(b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const f = new File([u], 'diagram.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(f);
      const el = document.querySelector('.react-flow__pane');
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 200 };
      el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o));
    }""", PNG)
    pg.wait_for_timeout(1200)
    check(pg.locator(".tile[data-kind=image]").count() == n_img + 1, "10 dropped PNG becomes an image tile")
    img = pg.locator(".tile[data-kind=image] img").last
    check(img.count() == 1 and (img.get_attribute("src") or "").startswith("data:image/png"), "10 image tile renders the picture")

    # ---- 2: memory auto-share + snippet → spawn carries the memory
    pg.locator("nav.rail").get_by_role("button", name="Memory").click()
    pg.wait_for_timeout(400)
    pg.get_by_role("button", name="+ Commands").click()
    txt = pg.locator("#memory-text").input_value()
    check("## Commands" in txt, "2 snippet inserted")
    pg.locator("#memory-text").fill("Use pnpm. Never push to main.")
    pg.get_by_label("Share with new agents automatically").check()
    pg.wait_for_timeout(600)
    check("29 /" in pg.get_by_test_id("memory-count").inner_text(), "2 character counter")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)

    # ---- 3: create a preset → sidebar button → console spawns with role + memory + MCP
    pg.locator("nav.rail").get_by_role("button", name="New agent preset").click()
    ed = pg.get_by_role("dialog", name="Agent preset")
    ed.get_by_role("textbox", name="Preset name").fill("PO")
    ed.get_by_role("radio", name="emoji:📋").click()
    ed.locator("#pr-role").fill("You are the Product Owner. Write user stories.")
    ed.get_by_role("button", name="+ MCP server").click()
    ed.get_by_role("textbox", name="MCP 1 name").fill("jira")
    ed.get_by_role("textbox", name="MCP 1 command or URL").fill("https://mcp.example.com/jira")
    ed.get_by_role("button", name="Create agent").click()
    pg.wait_for_timeout(600)
    btn = pg.get_by_role("button", name="Start PO")
    check(btn.count() == 1, "3 preset appears on the sidebar")
    before = len(pg.evaluate(SPAWNS))
    btn.click()
    pg.wait_for_timeout(1800)
    sp = pg.evaluate(SPAWNS)
    new = sp[before:] if len(sp) > before else []
    po = new[-1] if new else None
    check(po is not None, "3 clicking the preset creates + starts a console")
    if po:
        check("Product Owner" in po["prompt"] and "Your role on this team: PO" in po["prompt"], "3 spawn gets the preset role")
        check("Use pnpm" in po["prompt"], "2 spawn gets the auto-shared memory")
        check(po["mcp"] == [{"name": "jira", "target": "https://mcp.example.com/jira"}], "3 spawn gets the preset MCP server")
    check(pg.locator(".react-flow__node-console").filter(has_text="PO").count() >= 1, "3 console titled PO on the board")
    # right-click → edit
    btn.click(button="right")
    pg.wait_for_timeout(300)
    check(pg.get_by_role("dialog", name="Agent preset").get_by_role("textbox", name="Preset name").input_value() == "PO", "3 right-click opens the preset editor")
    pg.keyboard.press("Escape")

    pg.screenshot(path="/tmp/ab-v014.png")
    real_errors = [e for e in errors if "ResizeObserver" not in e]
    check(not real_errors, "No page errors: " + ("; ".join(real_errors[:3]) or "clean"))
    b.close()

print(f"RESULT {'FAIL' if fails else 'PASS'} {len(fails)}")
sys.exit(1 if fails else 0)

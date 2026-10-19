#!/usr/bin/env python3
"""Phase 8 UI: radial menu, new-console dialog, in-app confirm, group cwd, compose per-agent, tile … menu, top bar."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def ipc(pg, cmd):
    return [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == cmd]


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = false")  # exercise the real in-app dialog

    # ---- top bar (reference layout)
    check(pg.get_by_role("button", name="Back to home").count() == 1, "top bar: Back to home")
    check(pg.get_by_role("button", name="Settings").count() == 1, "single Settings entry (top bar)")
    check(pg.get_by_role("button", name="Fit all").count() == 0, "Fit all removed from rail")
    check(pg.get_by_role("button", name="Fit view").count() == 1, "Fit stays in zoom control")

    # ---- radial menu on empty canvas
    pane = pg.locator(".react-flow__pane")
    bb = pane.bounding_box()
    pg.mouse.click(bb["x"] + bb["width"] - 260, bb["y"] + 120, button="right")
    pg.wait_for_timeout(500)
    radial = pg.get_by_role("menu", name="Radial context menu")
    check(radial.count() == 1, "right-click empty canvas opens radial menu")
    items = radial.get_by_role("menuitem")
    check(items.count() == 9, f"radial has 9 items ({items.count()})")
    hub = radial.locator("button").first.bounding_box()
    first = items.first.bounding_box()
    check(first is not None and hub is not None and abs(first["y"] - hub["y"]) > 40, "items fan out from the hub")
    tiles0 = pg.locator(".tile[data-kind='note']").count()
    radial.get_by_role("menuitem", name="+ Note").click()
    pg.wait_for_timeout(500)
    check(pg.locator(".tile[data-kind='note']").count() == tiles0 + 1, "radial +Note adds a note tile")
    check(pg.get_by_role("menu", name="Radial context menu").count() == 0, "radial closes after action")

    pg.mouse.click(bb["x"] + bb["width"] - 260, bb["y"] + 120, button="right")
    pg.wait_for_timeout(300)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check(pg.get_by_role("menu", name="Radial context menu").count() == 0, "Esc closes radial menu")

    # ---- right-click a console opens its own menu (not the radial)
    pg.locator(".console .console-header").first.click(button="right")
    pg.wait_for_timeout(300)
    check(pg.get_by_role("menu", name="Radial context menu").count() == 0, "console right-click does not open radial")
    check(pg.locator(".console .menu").count() >= 1 or pg.get_by_role("menuitem", name="Rename").count() >= 1, "console right-click opens console menu")
    pg.keyboard.press("Escape")

    # ---- new console dialog (choose CLI, name, model)
    n0 = pg.locator(".console").count()
    pg.get_by_role("button", name="New console").click()
    dlg = pg.get_by_role("dialog", name="New Console")
    check(dlg.count() == 1, "New console opens dialog (no instant create)")
    dlg.get_by_role("button", name="Codex").click()
    check(dlg.get_by_label("Console Name").input_value().startswith("codex-"), "picking Codex renames default")
    dlg.get_by_label("Console Name").fill("api-worker")
    dlg.get_by_role("radio", name="GPT-5", exact=True).click()
    dlg.get_by_role("button", name="Create Console").click()
    pg.wait_for_timeout(900)
    check(pg.locator(".console").count() == n0 + 1, "console created")
    check(pg.get_by_text("api-worker").count() >= 1, "custom name shown")
    sp = [e for e in ipc(pg, "spawn_console") if e["args"]["args"]["id"] and e["args"]["args"].get("model") == "gpt-5"]
    check(len(sp) == 1 and sp[0]["args"]["args"]["agent"]["kind"] == "codex", "spawn got agent=codex model=gpt-5")

    # ---- in-app confirm replaces native MessageBox
    nat0 = len(ipc(pg, "plugin:dialog|ask")) + len(ipc(pg, "plugin:dialog|message"))
    pg.get_by_role("button", name="Pause all").click()
    pg.wait_for_timeout(400)
    cd = pg.get_by_role("dialog", name="Pause all")
    check(cd.count() == 1, "Pause all shows in-app confirm dialog")
    cd.get_by_role("button", name="Cancel").click()
    pg.wait_for_timeout(300)
    check(pg.get_by_role("dialog", name="Pause all").count() == 0, "Cancel closes it")
    nat1 = len(ipc(pg, "plugin:dialog|ask")) + len(ipc(pg, "plugin:dialog|message"))
    check(nat1 == nat0, "no native dialog IPC used")

    # ---- compose group: per-agent name + model
    pg.get_by_role("button", name="Spawn 4").click()
    cg = pg.get_by_role("dialog", name="Compose group")
    cg.locator("button[aria-pressed]").nth(1).click()
    ed = cg.get_by_role("group", name="Agent 2 settings")
    check(ed.count() == 1, "clicking an agent tile opens its editor")
    ed.get_by_label("Agent name").fill("reviewer")
    ed.get_by_role("radio", name="Opus").click()
    pg.wait_for_timeout(200)
    check("reviewer" in cg.inner_text() and "Opus" in cg.inner_text(), "tile shows name + model badge")
    before = len(ipc(pg, "spawn_console"))
    cg.get_by_role("button", name="Spawn 4").click()
    pg.wait_for_timeout(1500)
    new = ipc(pg, "spawn_console")[before:]
    rv = [e for e in new if e["args"]["args"].get("model") == "opus"]
    check(len(new) == 4 and len(rv) == 1, f"spawned 4, one with model=opus ({len(new)}, {len(rv)})")
    check(pg.get_by_text("reviewer").count() >= 1, "member named reviewer on board")

    # ---- group working directory for the whole group
    grp = pg.locator(".group-frame").last
    grp.get_by_role("button", name="Group menu").click()
    pg.get_by_role("menuitem", name="Set working directory…").click()
    pg.wait_for_timeout(400)
    gd = pg.get_by_role("dialog", name="Group working directory")
    check(gd.count() == 1, "group cwd asks in-app")
    k0 = len(ipc(pg, "kill_console"))
    gd.get_by_role("button", name="OK").click()
    pg.wait_for_timeout(2500)
    cwds = pg.evaluate("""(() => { const s = window.__board?.getState?.(); if (!s) return null;
      const ws = s.board.workspaces.find(w => w.id === s.board.active); const g = ws.groups[ws.groups.length-1];
      return ws.consoles.filter(c => c.group === g.id).map(c => c.cwd) })()""")
    if cwds is not None:
        check(len(cwds) == 4 and all(c == "C:/dev/picked" for c in cwds), f"all 4 members cwd = picked ({cwds})")
    late = [e["args"]["args"]["cwd"] for e in ipc(pg, "spawn_console")[before + 4:]]
    kd = len(ipc(pg, "kill_console")) - k0
    check(kd == 4 and late.count("C:/dev/picked") == 4, f"running members restarted in new folder (kills={kd}, spawns={late})")

    # ---- tile … menu (web)
    pg.get_by_role("button", name="Add tile").click()
    pg.get_by_role("menu", name="Add tile").get_by_role("menuitem", name="Web").click()
    pg.wait_for_timeout(400)
    web = pg.locator(".tile[data-kind='web']").last
    check(web.get_by_label("Device", exact=True).count() == 0, "web tile: second toolbar row gone")
    web.get_by_role("button", name="Tile options").click()
    check(pg.get_by_role("button", name="Remove tile").count() == 1, "… menu has Remove tile")
    pg.get_by_role("button", name="Pixel 8").click()
    pg.wait_for_timeout(300)
    check("pixel-8" in web.inner_text(), "preset badge in header")

    # ---- background glow follows pointer
    pg.mouse.move(bb["x"] + 300, bb["y"] + 500)
    pg.wait_for_timeout(200)
    glow = pg.evaluate("[...document.querySelectorAll('div')].some(d => (d.style.background||'').includes('radial-gradient'))")
    check(glow, "pointer glow layer present")

    pg.screenshot(path="/tmp/ab-phase8.png")
    check(not errors, "No page errors: " + ("; ".join(errors[:3]) or "clean"))
    b.close()

print(f"RESULT {'PASS' if not fails else 'FAIL'} {len(fails)}")
sys.exit(1 if fails else 0)

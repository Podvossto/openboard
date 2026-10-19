#!/usr/bin/env python3
"""Headless UI smoke test against the Vite dev server with a mocked Tauri IPC.
usage: npx vite --mode mock --port 1421 &  then  ~/9r-venv/bin/python scripts/ui-smoke.py
"""
import json, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1421/"
fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(URL); pg.wait_for_selector(".console", timeout=10000)
    pg.wait_for_timeout(800)
    check(pg.locator(".console").count() == 2, "2 consoles rendered from workspace")
    check("attached c1" in pg.locator(".console").nth(0).inner_text(), "running console attached + replayed output")
    check(pg.locator(".console.attention").count() == 1, "needs-you highlight from status event")
    check(pg.locator(".pill.needs").inner_text().startswith("1"), "toolbar counts needs-you")
    c2 = pg.locator(".console").nth(1)
    check(c2.get_by_text("Resume last session").count() == 1, "stopped codex console offers resume")
    check(pg.get_by_role("button", name="+ Codex").is_disabled(), "codex button disabled when not on PATH")
    # start stopped console
    c2.get_by_text("Start new").click(); pg.wait_for_timeout(400)
    log = pg.evaluate("window.__ipcLog")
    spawns = [e for e in log if e["cmd"] == "spawn_console"]
    check(len(spawns) == 1 and spawns[0]["args"]["args"]["resume"] is False, "Start new → spawn_console(resume=false)")
    # add console via toolbar
    pg.get_by_role("button", name="+ Shell").click(); pg.wait_for_timeout(600)
    check(pg.locator(".console").count() == 3, "+ Shell adds a console")
    # drag a console by its header (fit all first; wait for the fitView animation)
    pg.get_by_role("button", name="Fit view").click(); pg.wait_for_timeout(700)
    h = pg.locator(".console-header").nth(0).bounding_box()
    pg.mouse.move(h["x"] + 60, h["y"] + 10); pg.mouse.down()
    pg.mouse.move(h["x"] + 160, h["y"] + 210, steps=8); pg.mouse.up()
    pg.wait_for_timeout(900)
    h2 = pg.locator(".console-header").nth(0).bounding_box()
    check(abs(h2["y"] - h["y"]) > 50, f"drag moves node and it stays (dy={h2['y']-h['y']:.0f})")
    saves = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "save_workspace"]
    check(len(saves) >= 1, f"autosave fired ({len(saves)} saves)")
    if saves:
        ws = saves[-1]["args"]["workspace"]
        check(len(ws["consoles"]) == 3 and ws["consoles"][0]["y"] > 0, f"saved workspace has new position + 3 consoles (y={ws['consoles'][0]['y']})")
    # close console (dialog mocked → yes)
    pg.locator(".console").nth(2).locator("button[title=Close]").click(); pg.wait_for_timeout(500)
    check(pg.locator(".console").count() == 2, "close removes console")
    pg.screenshot(path="/tmp/ab-ui.png")
    check(not errors, "no page errors: " + "; ".join(errors[:3]))
    b.close()
print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

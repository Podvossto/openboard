#!/usr/bin/env python3
"""Phase-4 smoke (mock IPC): ink, profiles (+ provider key), usage popover, orchestrator lead + spawn."""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def log(pg):
    return pg.evaluate("window.__ipcLog")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    # ---- ink
    pg.get_by_role("button", name="Draw").click()
    check(pg.get_by_role("toolbar", name="Ink").count() == 1, "ink toolbar opens")
    surf = pg.get_by_label("Drawing surface")
    box = surf.bounding_box()
    x0, y0 = box["x"] + 300, box["y"] + 500
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    for i in range(1, 25):
        pg.mouse.move(x0 + i * 12, y0 + (i % 6) * 6)
    pg.mouse.up()
    pg.wait_for_timeout(200)
    check(pg.locator("svg.ink-strokes path").count() == 1, "stroke drawn and kept")
    pg.keyboard.press("e")
    check(pg.get_by_label("Eraser surface").count() == 1, "E switches to eraser")
    pg.mouse.move(x0 + 120, y0 + 30)
    pg.mouse.down()
    pg.mouse.move(x0 + 130, y0 + 20)
    pg.mouse.move(x0 + 140, y0 + 40)
    pg.mouse.up()
    pg.wait_for_timeout(200)
    check(pg.locator("svg.ink-strokes path").count() == 0, "eraser removes stroke")
    pg.keyboard.press("p")
    pg.mouse.move(x0, y0 - 100)
    pg.mouse.down()
    pg.mouse.move(x0 + 200, y0 - 60, steps=10)
    pg.mouse.up()
    pg.keyboard.press("Escape")
    check(pg.get_by_role("toolbar", name="Ink").count() == 0, "Esc leaves ink mode")
    pg.wait_for_timeout(1500)
    saves = [e for e in log(pg) if e["cmd"] == "save_board"]
    check(bool(saves) and '"ink"' in json.dumps(saves[-1]["args"]) and '"points"' in json.dumps(saves[-1]["args"]), "ink persisted via save_board")

    # ---- usage popover
    pg.get_by_role("button", name="Usage").click()
    dlg = pg.get_by_role("dialog", name="Usage by account")
    check(dlg.count() == 1 and dlg.get_by_text("Z.ai GLM").count() == 1 and dlg.get_by_text("Codex (default)").count() == 1, "usage popover lists Claude/Codex/Z.ai")
    pg.keyboard.press("Escape")

    # ---- profiles: add a Z.ai provider + key, add a second Claude account
    pg.locator("button[aria-label='Settings']").first.click()
    pg.wait_for_timeout(400)
    sheet = pg.get_by_role("dialog", name="Settings")
    sheet.get_by_role("button", name="+ Provider").click()
    grp = sheet.get_by_role("group", name="New provider")
    grp.get_by_role("button", name="Z.ai (GLM Coding Plan)").click()
    grp.get_by_role("button", name="Add").click()
    pg.wait_for_timeout(500)
    card = sheet.locator("[data-profile]").first
    check(card.count() == 1 and card.get_by_label("Base URL").input_value() == "https://api.z.ai/api/anthropic", "Z.ai provider profile added")
    card.get_by_label("API key").fill("sk-test-123456789")
    card.get_by_role("button", name="Save key").click()
    pg.wait_for_timeout(300)
    sk = [e for e in log(pg) if e["cmd"] == "set_profile_key"]
    check(len(sk) == 1 and card.get_by_label("API key").input_value() == "", "key sent to credential store, field cleared")
    pg.wait_for_timeout(800)
    saved = [e for e in log(pg) if e["cmd"] == "save_settings"]
    check(bool(saved) and "sk-test" not in json.dumps(saved[-1]["args"]), "key never written to settings")
    sheet.get_by_role("button", name="+ Account").click()
    sheet.get_by_role("group", name="New account").get_by_role("button", name="Add").click()
    pg.wait_for_timeout(500)
    check(sheet.locator("[data-profile]").count() == 2, "second Claude account added")
    pg.screenshot(path="/tmp/ab-profiles.png")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)

    # switch the api console (claude) to the Z.ai profile
    api = pg.locator(".console", has_text="api").first
    api.get_by_role("button", name="More").click()
    api.get_by_role("menuitemradio", name="Z.ai (GLM Coding Plan)").click()
    pg.wait_for_timeout(300)
    if pg.get_by_role("button", name="OK").count():
        pg.get_by_role("button", name="OK").click()
    check(api.get_by_title("Account: Z.ai (GLM Coding Plan)").count() == 1, "console shows account tag")

    # ---- orchestrator
    api.get_by_role("button", name="More").click()
    api.get_by_role("menuitemcheckbox", name="Make orchestrator lead").click()
    pg.wait_for_timeout(500)
    check(api.get_by_text("Lead", exact=True).count() == 1, "lead badge shown")
    roster = pg.evaluate("window.__roster")
    check(isinstance(roster, list) and any(r["title"] == "api" for r in roster), "roster synced to backend")
    before = pg.locator(".console").count()
    pg.evaluate("window.__mock.emit('orchestrator://spawn', {from: 'c1', agent: 'codex', title: 'reviewer-x', task: 'review src/api.ts'})")
    pg.wait_for_timeout(1500)
    titles = pg.locator(".console .console-header").all_inner_texts()
    check(any("reviewer-x" in t for t in titles), f"lead spawn request creates a console ({before}→{len(titles)})")
    sp = [e for e in log(pg) if e["cmd"] == "spawn_console" and e["args"]["args"]["agent"]["kind"] == "codex"]
    check(len(sp) >= 1, "spawned worker auto-started")

    pg.screenshot(path="/tmp/ab-phase4.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

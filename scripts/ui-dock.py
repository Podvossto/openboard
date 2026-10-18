#!/usr/bin/env python3
"""Screenshot the dock + compose popover (mock IPC)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
fails = []
def check(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: fails.append(m)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(URL); pg.wait_for_selector(".ring-pill", timeout=15000); pg.wait_for_timeout(900)
    labels = [t.strip() for t in pg.get_by_role("toolbar", name="Board dock").locator(".ring-pill").all_inner_texts()]
    check(labels[:7] == ["New console", "Spawn 4", "Group", "Presets", "Pause all", "Resume all", "Memory"], f"pill row {labels}")
    check(pg.get_by_label("Command bar").count() == 1, "composer present")
    pg.screenshot(path="/tmp/ab-dock.png")
    pg.get_by_role("button", name="Spawn 4").click(); pg.wait_for_timeout(400)
    dlg = pg.get_by_role("dialog", name="Compose group")
    check(dlg.count() == 1, "compose popover opens")
    dlg.get_by_role("radio", name="Frontend").click()
    dlg.get_by_label("More").click(); dlg.get_by_label("More").click()
    check(dlg.get_by_role("button", name="Spawn 6").count() == 1, "stepper → Spawn 6")
    pg.screenshot(path="/tmp/ab-compose.png")
    dlg.get_by_role("button", name="Spawn 6").click(); pg.wait_for_timeout(900)
    check(pg.locator(".console").count() == 10, f"6 consoles added (total {pg.locator('.console').count()})")
    log = pg.evaluate("window.__ipcLog")
    spawns = [e for e in log if e["cmd"] == "spawn_console"]
    check(len(spawns) >= 6, f"auto-started {len(spawns)} consoles")
    # mention popover
    ta = pg.get_by_label("Command bar"); ta.click(); ta.type("@fro")
    pg.wait_for_timeout(300)
    check(pg.get_by_role("listbox", name="Mentions").count() == 1, "@ autocomplete opens")
    pg.screenshot(path="/tmp/ab-mention.png")
    # AI dispatcher: plain text -> plan preview -> Run
    web = pg.locator(".console", has_text="web").first
    for name in ["Start new", "Resume last session"]:
        btn = web.get_by_role("button", name=name)
        if btn.count():
            btn.first.dispatch_event("click"); break
    pg.wait_for_timeout(700)
    ta.fill(""); ta.type("pass this task to codex"); ta.press("Enter"); pg.wait_for_timeout(500)
    plan = pg.get_by_role("dialog", name="Dispatch plan")
    check(plan.count() == 1 and "Hand off" in plan.inner_text(), "dispatcher shows handoff plan")
    pg.screenshot(path="/tmp/ab-plan.png")
    plan.get_by_role("button", name="Run ↵").click(); pg.wait_for_timeout(700)
    log = pg.evaluate("window.__ipcLog")
    check(any(e["cmd"] == "route_instruction" for e in log) and any(e["cmd"] == "handoff_brief" for e in log), "route → handoff_brief called")
    check(plan.count() == 0, "plan closes after run")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()
print("RESULT", "FAIL" if fails else "PASS", len(fails)); sys.exit(1 if fails else 0)

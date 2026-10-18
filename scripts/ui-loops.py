#!/usr/bin/env python3
"""Loop smoke (mock IPC): idle loop fires, counts runs, stops when the goal check says done."""
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
    pg.clock.install()
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.clock.run_for(1500)
    # start "web" (resting after start in the mock)
    web = pg.locator(".console", has_text="web").first
    web.get_by_role("button", name="Start new").dispatch_event("click")
    pg.clock.run_for(1500)
    web.get_by_role("button", name="More").click()
    web.get_by_role("menuitem", name="Loop…").click()
    dlg = web.get_by_role("dialog", name="Loop")
    check(dlg.count() == 1, "loop editor opens")
    dlg.get_by_label("Idle seconds").fill("5")
    dlg.locator("textarea").fill("run the tests again")
    dlg.get_by_label("Max runs").fill("5")
    pg.locator("[id^=loop-goal-]").fill("all tests pass")
    dlg.get_by_role("button", name="Start loop").click()
    check(web.get_by_label("Loop running").count() == 1, "loop badge shown")
    # mock console is resting; advance time past idle threshold + ticks
    for _ in range(8):
        pg.clock.run_for(5000)
        pg.wait_for_timeout(50)
    log = pg.evaluate("window.__ipcLog")
    writes = [e for e in log if e["cmd"] == "write_console" and "run the tests again" in str(e["args"].get("data", ""))]
    check(len(writes) >= 1, f"loop submitted message ({len(writes)}x)")
    for _ in range(12):
        pg.clock.run_for(5000)
        pg.wait_for_timeout(50)
    goal_calls = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "loop_goal_check"]
    check(len(goal_calls) >= 2, f"goal checked ({len(goal_calls)}x)")
    # Fake clock doesn't drive motion's exit animation, so assert on the persisted state instead
    # (badge exit is covered with a real clock in ui-motion.py).
    pg.clock.run_for(1500)
    saves = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "save_board"]
    loops = [c.get("loop") for w in (saves[-1]["args"]["board"]["workspaces"] if saves else []) for c in w["consoles"] if c.get("loop")]
    check(bool(loops) and loops[0]["enabled"] is False and loops[0]["stoppedReason"].startswith("Goal met"), "loop stopped after goal met")
    web.get_by_role("button", name="More").click()
    web.get_by_role("menuitem", name="Loop…").click()
    check("Goal met" in web.get_by_role("dialog", name="Loop").inner_text(), "stop reason shown")
    pg.screenshot(path="/tmp/ab-loop.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Headless UI smoke test against the Vite dev server with a mocked backend.

    npx vite --mode mock --port 1421 &
    pip install playwright && playwright install chromium
    python scripts/ui-smoke.py [http://localhost:1421/]

Checks that the sample board renders, workspace tabs switch, the settings
sheet shows the app version, and nothing logs a page error. Exit code 1 on failure.
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1421/"
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(URL)
    pg.wait_for_selector(".console", timeout=10000)
    pg.wait_for_timeout(800)
    check(pg.locator(".console").count() == 4, "sample board renders 4 consoles")
    check("attached c1" in pg.locator(".console").nth(0).inner_text(), "running console attaches and replays output")
    check(pg.locator(".console.attention").count() == 1, "needs-you highlight from status event")

    pg.get_by_role("tab", name="Research").click()
    pg.wait_for_timeout(500)
    check(pg.locator(".console").count() == 0, "switching to an empty workspace hides the consoles")
    pg.get_by_role("tab", name="Main").click()
    pg.wait_for_selector(".console", timeout=5000)

    pg.get_by_role("button", name="Settings").first.click()
    pg.wait_for_selector("[data-testid=app-version]", timeout=5000)
    check(pg.locator("[data-testid=app-version]").inner_text().strip() not in ("", "—"), "settings shows the app version")

    check(not errors, "no page errors: " + "; ".join(errors[:3]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Headless UI smoke test for Agent Board v2 layout and interactions."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1422/"
fails = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))

    pg.goto(URL)
    pg.wait_for_selector(".topbar", timeout=10000)
    pg.wait_for_timeout(1000)

    # 1. TopBar & Workspace tabs
    check(pg.locator(".ws-tab").count() >= 2, "Workspace tabs rendered (Main, Research)")
    check("Main" in pg.locator(".ws-tab.active").inner_text(), "Main tab is active")
    check(pg.locator(".usage-pill").count() == 1, "Claude usage pill rendered")
    print("Usage text:", pg.locator(".usage-pill").inner_text().strip())

    # 2. Rail & Dock
    check(pg.locator(".rail").count() == 1, "Left rail rendered")
    check(pg.locator(".dock").count() == 1, "Floating dock rendered")
    check(pg.locator(".cmdbar").count() == 1, "Command bar rendered in dock")
    check(pg.locator(".zoom-control").count() == 1, "Zoom controls rendered")

    # 3. Consoles & Group
    check(pg.locator(".group-frame").count() >= 1, "Group node rendered (DOCS)")
    check(pg.locator(".console").count() >= 4, f"Consoles rendered ({pg.locator('.console').count()})")

    # 4. Status indicator on c1 (needs you)
    check(pg.locator(".needs-you, .attention").count() >= 1, "Needs-you console blinking/highlighted")

    # 5. Open Settings Panel
    pg.locator("button[aria-label='Settings']").first.click()
    pg.wait_for_timeout(600)
    sheet = pg.locator("aside[aria-label='Settings'], .sheet")
    check(sheet.count() >= 1, "Settings panel opened")
    check("Claude Code" in sheet.inner_text(), "Claude account card visible in Settings")
    check("dev@example.com" in sheet.inner_text(), "Claude logged-in detail visible in Settings")

    # Close settings
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check(sheet.count() == 0, "Settings panel closed on Escape")

    # 6. Open Memory Panel from Rail
    pg.locator(".rail button[aria-label='Memory'], .rail button[title='Memory']").first.click()
    pg.wait_for_timeout(600)
    mem = pg.locator("aside[aria-label='Workspace memory'], .sheet")
    check(mem.count() >= 1, "Memory panel opened")
    check("Use pnpm" in mem.locator("textarea").input_value(), "Workspace memory loaded in panel")

    # Close memory
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check(mem.count() == 0, "Memory panel closed on Escape")

    # 7. Take screenshot
    pg.screenshot(path="/tmp/ab-ui-v2.png")
    print("Saved screenshot to /tmp/ab-ui-v2.png")

    check(not errors, "No page errors: " + ("; ".join(errors[:3]) if errors else "clean"))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

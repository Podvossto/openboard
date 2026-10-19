#!/usr/bin/env python3
"""In-app updater (mock IPC): startup prompt → Later → small top-bar Update button →
re-open → Update now (progress, install). Settings › General: version + manual check
(up to date / unreachable)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5315/"
fails, errors = [], []
UPDATE = '{"version":"0.2.0","currentVersion":"0.1.0","notes":"- usage modal\\n- in-app updates","date":"2026-10-19 04:00:00 +00:00:00"}'


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- 1. update available on start
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(f"window.__update = {UPDATE};")
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    dlg = pg.get_by_role("dialog", name="Update available")
    dlg.wait_for(timeout=12000)  # auto check runs ~5s after start
    check("0.2.0 is available" in dlg.inner_text(), "prompt names the new version")
    check("You have 0.1.0" in dlg.inner_text(), "prompt shows current version")
    check("in-app updates" in dlg.locator("[data-testid=update-notes]").inner_text(), "release notes shown")
    btn_top = pg.get_by_role("button", name="Update to 0.2.0")
    check(btn_top.count() == 0, "no top-bar button while the prompt is open")

    dlg.get_by_role("button", name="Later").click()
    pg.wait_for_timeout(500)
    check(pg.get_by_role("dialog", name="Update available").count() == 0, "Later closes the prompt")
    btn_top.wait_for(timeout=3000)
    check(btn_top.is_visible() and "Update" in btn_top.inner_text(), "small Update button appears in the top bar")

    # a later automatic check must not nag for the same version
    pg.evaluate("window.__ipcLog.length = 0")
    pg.evaluate("() => window.__TAURI_INTERNALS__.invoke('update_check')")
    pg.wait_for_timeout(300)
    check(pg.get_by_role("dialog", name="Update available").count() == 0, "deferred version does not re-prompt")

    # re-open from the button and install
    btn_top.click()
    dlg = pg.get_by_role("dialog", name="Update available")
    dlg.wait_for(timeout=3000)
    check(True, "top-bar button re-opens the prompt")
    dlg.get_by_role("button", name="Update now").click()
    prog = dlg.locator("[data-testid=update-progress]")
    prog.wait_for(timeout=3000)
    check(prog.is_visible(), "download progress shown")
    check(dlg.get_by_role("button", name="Later").is_disabled(), "Later disabled while downloading")
    pg.wait_for_function("window.__installed === true", timeout=5000)
    log = [e["cmd"] for e in pg.evaluate("window.__ipcLog")]
    check("update_install" in log, "update_install invoked")
    pg.wait_for_timeout(300)
    check("Installing" in prog.inner_text() or "2.0 MB" in prog.inner_text(), f"progress reached the end ({prog.inner_text()!r})")
    pg.screenshot(path="/tmp/ab-updater.png")
    pg.close()

    # ---- 2. up to date → Settings manual check; then unreachable
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(6500)
    check(pg.get_by_role("dialog", name="Update available").count() == 0, "no prompt when up to date")
    check(pg.get_by_role("button", name="Update to 0.2.0").count() == 0, "no top-bar button when up to date")
    pg.locator("button[aria-label='Settings']").first.click()
    sheet = pg.get_by_role("dialog", name="Settings")
    sheet.wait_for(timeout=3000)
    box = sheet.locator("[data-testid=update-settings]")
    check(box.locator("[data-testid=app-version]").inner_text() == "0.1.0", "Settings shows the app version")
    box.get_by_role("button", name="Check for updates").click()
    pg.wait_for_timeout(400)
    check("latest version" in box.locator("[data-testid=update-status]").inner_text(), "manual check: up to date")

    pg.evaluate("window.__update = 'fail'")
    box.get_by_role("button", name="Check for updates").click()
    pg.wait_for_timeout(400)
    st = box.locator("[data-testid=update-status]").inner_text()
    check("private network" in st, f"manual check: unreachable explained ({st!r})")

    pg.evaluate(f"window.__update = {UPDATE}")
    box.get_by_role("button", name="Check for updates").click()
    pg.get_by_role("dialog", name="Update available").wait_for(timeout=3000)
    check(True, "manual check with an update opens the prompt")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(500)
    check(pg.get_by_role("dialog", name="Update available").count() == 0, "Esc = Later")
    check(box.get_by_role("button", name="Update to 0.2.0").count() == 1, "Settings offers 'Update to 0.2.0' afterwards")

    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

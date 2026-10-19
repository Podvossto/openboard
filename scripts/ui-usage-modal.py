#!/usr/bin/env python3
"""Usage modal (mock IPC): pill → modal, gauge, weekly bars, heatmap, summary, account tabs,
Esc, per-console chip + console menu 'Usage'."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5313/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def human(n):
    if n >= 1e9:
        return f"{int(n / 1e8 + 0.5) / 10:g}b"
    if n >= 1e6:
        return f"{int(n / 1e5 + 0.5) / 10:g}m"
    if n >= 1e5:
        return f"{int(n / 1e3 + 0.5)}k"
    if n >= 1e3:
        return f"{int(n / 100 + 0.5) / 10:g}k"
    return str(n)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    # per-console chip (mock: session s1 → 12,400 tokens)
    chip = pg.locator(".console-tokens").first
    chip.wait_for(timeout=8000)
    check("12.4k tok" in chip.inner_text(), f"console header chip shows 12.4k tok ({chip.inner_text()!r})")

    pill = pg.get_by_role("button", name="Usage", exact=True)
    check(pill.count() == 1, "usage pill keeps aria-label Usage")
    pill.click()
    dlg = pg.get_by_role("dialog", name="Usage", exact=True)
    dlg.wait_for(timeout=3000)
    pg.wait_for_timeout(600)
    check(dlg.locator("h2").inner_text() == "usage", "title is lowercase 'usage'")
    check(pg.get_by_role("dialog", name="Usage by account").count() == 0, "old popover is gone")

    check(dlg.locator("[data-testid=session-pct]").inner_text() == "34", "gauge shows mocked 34%")
    check("34%" in dlg.get_by_role("img", name="34% used").evaluate("e => e.textContent"), "gauge ring svg labelled 34% used")
    check("Current session" in dlg.inner_text() and "Resets" in dlg.locator("[data-testid=session-section]").inner_text(), "session caption + Resets text")
    check("71%" in dlg.locator("[data-testid=weekly-all]").inner_text(), "weekly all-models bar 71%")
    sonnet = dlg.locator("[data-testid=weekly-sonnet]")
    check("17%" in sonnet.inner_text() and "Current week (Sonnet)" in sonnet.inner_text(), "per-model weekly bar Sonnet 17%")
    check("Resets" in sonnet.inner_text() and " at " in sonnet.inner_text(), "weekly bar has 'Resets <date> at <time>'")

    # heatmap + summary for 30d
    an30 = pg.evaluate("(d) => window.__mock.analytics(d)", 30)
    cells = dlg.locator(".usage-heat-cell")
    check(cells.count() == 30, f"30 heatmap cells for 30d (got {cells.count()})")
    lv = set(cells.evaluate_all("els => els.map(e => e.getAttribute('data-level'))"))
    check(len(lv) >= 2, "heatmap has several intensity levels")
    check(dlg.get_by_text("Less", exact=True).count() == 1 and dlg.get_by_text("More", exact=True).count() == 1, "Less … More legend")
    txt = lambda s: dlg.locator(f"[data-stat={s}]").inner_text()
    check(human(an30["totals"]["tokens"]) in txt("total-tokens"), f"total tokens {human(an30['totals']['tokens'])}")
    check(str(an30["totals"]["sessions"]) in txt("sessions"), "sessions from mock")
    active = sum(1 for d in an30["days"] if d["byAgent"])
    check(f"{active}/30" in txt("active-days"), f"active days {active}/30")
    check("Opus 4.5" in txt("favorite-model"), "favorite model Opus 4.5")
    check("4h 12m" in txt("longest-session"), "longest session 4h 12m")
    check(human(an30["peakDay"]["tokens"]) in txt("most-active-day"), "most active day tokens")
    check("your subscription" in dlg.inner_text() and "/usage" in dlg.inner_text(), "footer breadcrumb + subscription note")

    # range toggle
    dlg.get_by_role("radio", name="90d").click()
    pg.wait_for_timeout(500)
    check(dlg.locator(".usage-heat-cell").count() == 90, "90 cells for 90d")
    dlg.get_by_role("radio", name="All time").click()
    pg.wait_for_timeout(500)
    n_all = dlg.locator(".usage-heat-cell").count()
    check(0 < n_all <= 365, f"All time cells present ({n_all})")

    # account tabs
    tabs = dlg.get_by_role("tab")
    check(tabs.count() == 3, f"3 account tabs (got {tabs.count()})")
    dlg.get_by_role("tab", name="Codex (default)").click()
    pg.wait_for_timeout(300)
    check(dlg.locator("[data-testid=session-pct]").inner_text() == "12", "Codex tab shows 12%")
    check(dlg.locator("[data-testid=weekly-all]").inner_text().count("40%") == 1, "Codex weekly 40%")
    dlg.get_by_role("tab", name="Z.ai GLM").click()
    pg.wait_for_timeout(300)
    check(dlg.locator("[data-testid=session-pct]").inner_text() == "1", "Z.ai tab shows 1%")

    pg.screenshot(path="/tmp/ab-usage-modal.png")

    # Esc closes, role dropped while exiting
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(30)
    check(pg.get_by_role("dialog", name="Usage", exact=True).count() == 0, "dialog role dropped immediately while exiting")
    pg.locator(".fixed.inset-0.z-\\[100\\]").wait_for(state="detached", timeout=3000)
    check(True, "Esc closes the modal")

    # Details → old analytics sheet still reachable
    pill.click()
    pg.get_by_role("dialog", name="Usage", exact=True).wait_for(timeout=3000)
    pg.get_by_role("button", name="Details").click()
    pg.get_by_role("dialog", name="Usage analytics").wait_for(timeout=3000)
    check(True, "Details opens the detailed analytics sheet")
    pg.wait_for_timeout(400)
    pg.keyboard.press("Escape")
    try:
        pg.get_by_role("dialog", name="Usage analytics").wait_for(state="detached", timeout=3000)
    except Exception:
        print("DEBUG", pg.evaluate("[...document.querySelectorAll('[role=dialog]')].map(e=>e.getAttribute('aria-label')+'|'+getComputedStyle(e).opacity)"), pg.locator(".usage-backdrop").evaluate_all("e=>e.map(x=>getComputedStyle(x).opacity+x.outerHTML.slice(0,80))"))
    pg.wait_for_timeout(300)

    # console menu → Usage opens modal focused on that console
    pg.locator("button[aria-label=More]").first.click()
    pg.get_by_role("menuitem", name="Usage").click()
    dlg = pg.get_by_role("dialog", name="Usage", exact=True)
    dlg.wait_for(timeout=3000)
    pg.wait_for_timeout(500)
    cu = dlg.locator("[data-testid=console-usage]")
    check(cu.count() == 1, "console section shown")
    check("12.4k" in cu.inner_text() and "37" in cu.inner_text() and "Opus 4.5" in cu.inner_text(), "console tokens / messages / model")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(900)

    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

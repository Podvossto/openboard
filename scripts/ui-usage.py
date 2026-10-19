#!/usr/bin/env python3
"""Usage analytics panel (mock IPC): popover → Analytics sheet, 8 stat cards,
stacked bars for the period, heatmap cells, period switch, Esc close."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1433/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def fmt(n):
    """Mirror of src/features/usage/calc.ts formatTokens (half-up rounding)."""
    def trim(v):
        s = f"{int(v * 10 + 0.5) / 10:g}"
        return s
    if n >= 1e9:
        return trim(n / 1e9) + "B"
    if n >= 1e6:
        return trim(n / 1e6) + "M"
    if n >= 1e3:
        return f"{int(n / 1e3 + 0.5)}k"
    return str(n)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    # open the usage modal from the top bar, then the detailed analytics via Details
    pg.get_by_role("button", name="Usage", exact=True).click()
    modal = pg.get_by_role("dialog", name="Usage", exact=True)
    modal.wait_for(timeout=3000)
    btn = modal.get_by_role("button", name="Details")
    check(btn.count() == 1, "usage modal has Details button")

    # open the analytics sheet
    btn.click()
    sheet = pg.get_by_role("dialog", name="Usage analytics")
    sheet.wait_for(timeout=3000)
    pg.wait_for_timeout(500)

    an30 = pg.evaluate("(d) => window.__mock.analytics(d)", 30)
    cards = sheet.locator("[data-stat]")
    check(cards.count() == 8, "8 stat cards rendered")
    total_card = sheet.locator("[data-stat='total-tokens']")
    want_total = fmt(an30["totals"]["tokens"])
    check(want_total in total_card.inner_text(), f"total tokens card shows mock value ({want_total})")
    sess_card = sheet.locator("[data-stat='sessions']")
    check(str(an30["totals"]["sessions"]) in sess_card.inner_text(), "sessions card shows mock value")
    top_card = sheet.locator("[data-stat='top-agent']")
    check(an30["topAgent"]["agent"].capitalize() in top_card.inner_text(), "top agent card shows mock agent")
    cur = sheet.locator("[data-stat='current-streak']")
    check(f"{an30['streaks']['current']} day" in cur.inner_text(), "current streak card shows mock streak")
    peak = sheet.locator("[data-stat='peak-day']")
    check(fmt(an30["peakDay"]["tokens"]) in peak.inner_text(), "peak day card shows mock peak")

    bars = sheet.locator(".usage-chart [data-date]")
    check(bars.count() == 30, f"30 bars for 30d (got {bars.count()})")

    # hover a bar → tooltip with per-agent breakdown
    bars.nth(29).hover()
    pg.wait_for_timeout(250)
    tip = sheet.locator(".usage-tip")
    check(tip.is_visible(), "bar tooltip visible on hover")
    check("Claude" in tip.inner_text() and "tokens" in tip.inner_text(), "tooltip lists agent + tokens")

    # legend present (2 series)
    check(sheet.locator(".usage-legend-item").count() >= 2, "chart legend lists agents")

    # heatmap cells + legend
    heat = sheet.locator(".usage-heat-cell")
    check(heat.count() >= 30, f"heatmap cells present (got {heat.count()})")
    check(sheet.get_by_text("Less", exact=True).count() >= 1 and sheet.get_by_text("More", exact=True).count() >= 1, "heatmap legend Less…More")
    lvls = set(heat.evaluate_all("els => els.map(e => e.getAttribute('fill'))"))
    check(len(lvls) >= 2, f"heatmap uses >1 intensity level ({len(lvls)})")

    # period switch 30d → 7d
    sheet.get_by_role("radio", name="7d").click()
    pg.wait_for_timeout(500)
    check(sheet.locator(".usage-chart [data-date]").count() == 7, "7 bars after switching to 7d")
    an7 = pg.evaluate("(d) => window.__mock.analytics(d)", 7)
    check(fmt(an7["totals"]["tokens"]) in sheet.locator("[data-stat='total-tokens']").inner_text(), "total updates for 7d")
    log = pg.evaluate("window.__ipcLog")
    days_arg = [e["args"].get("days") for e in log if e["cmd"] == "usage_analytics"]
    check(days_arg[-1] == 7, "usage_analytics invoked with days=7")

    # 90d too
    sheet.get_by_role("radio", name="90d").click()
    pg.wait_for_timeout(500)
    check(sheet.locator(".usage-chart [data-date]").count() == 90, "90 bars after switching to 90d")

    # Esc closes the sheet (and only the sheet)
    pg.keyboard.press("Escape")
    try:
        pg.get_by_role("dialog", name="Usage analytics").wait_for(state="detached", timeout=3000)
    except Exception:
        pass
    check(pg.get_by_role("dialog", name="Usage analytics").count() == 0, "Esc closes the analytics sheet")
    check(pg.get_by_role("button", name="Usage", exact=True).is_visible(), "app still alive after close")

    pg.screenshot(path="/tmp/ab-usage.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

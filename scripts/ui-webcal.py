#!/usr/bin/env python3
"""Web tile device presets + Calendar tile smoke (mock IPC)."""
import calendar as cal_mod
import sys
from datetime import date
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1431/"
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def add(pg, label):
    pg.get_by_role("button", name="Add tile").click()
    pg.get_by_role("menu", name="Add tile").get_by_role("menuitem", name=label).click()
    pg.wait_for_timeout(350)
    return pg.locator(f".tile[data-kind='{label.lower()}']").last


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    today = date.today()
    d15 = today.replace(day=15)
    iso15 = d15.isoformat()
    month_txt = f"{cal_mod.month_name[today.month]} {today.year}"

    # ---------- Part A: web tile device presets ----------
    web = add(pg, "Web")
    check(web.locator("iframe").count() == 1, "responsive default fills the tile with an iframe")

    web.get_by_role("button", name="Tile options").click()
    pg.get_by_role("button", name="iPhone 15 Pro").click()
    pg.wait_for_timeout(300)
    frame = web.locator("iframe")
    check(frame.get_attribute("width") == "393" and frame.get_attribute("height") == "852", "iframe attrs 393x852")
    check(frame.evaluate("el => getComputedStyle(el).width") == "393px", "iframe style width is 393px")
    label = web.get_by_label("Device size", exact=True)
    check("393 × 852" in label.inner_text(), f"size label 393 × 852 ({label.inner_text().strip()})")

    web.get_by_role("button", name="Rotate device").click()
    pg.wait_for_timeout(300)
    check(frame.get_attribute("width") == "852" and frame.get_attribute("height") == "393", "rotate swaps to 852x393")
    check("852 × 393" in web.get_by_label("Device size", exact=True).inner_text(), "size label 852 × 393")

    web.get_by_role("button", name="Tile options").click()
    pg.get_by_role("button", name="50%", exact=True).click()
    pg.wait_for_timeout(300)
    check("scale(0.5)" in frame.evaluate("el => el.parentElement.style.transform"), "zoom 50% scales the device frame")
    check("· 50%" in web.get_by_label("Device size", exact=True).inner_text(), "size label shows 50%")

    pg.wait_for_timeout(1800)  # autosave debounce
    saves = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "save_board"]
    webd = [t["data"] for t in saves[-1]["args"]["board"]["workspaces"][0].get("tiles", []) if t["kind"] == "web"] if saves else []
    check(
        bool(webd)
        and webd[-1].get("preset") == "iphone-15-pro"
        and webd[-1].get("w") == 852
        and webd[-1].get("h") == 393
        and webd[-1].get("rotated") is True
        and webd[-1].get("zoom") == 0.5,
        "web device settings persisted via save_board",
    )

    # ---------- Part B: calendar tile ----------
    cal = add(pg, "Calendar")
    check(cal.get_by_text(month_txt).count() == 1, f"month header shows {month_txt}")
    check(all(cal.get_by_text(d, exact=True).count() >= 1 for d in WD), "Mon-first weekday header")
    check(cal.locator(".ring-accent").count() == 1, "today highlighted")

    cal.get_by_role("button", name="Previous").click()
    pg.wait_for_timeout(250)
    check(cal.get_by_text(month_txt).count() == 0, "Previous leaves the month")
    cal.get_by_role("button", name="Today").click()
    pg.wait_for_timeout(250)
    check(cal.get_by_text(month_txt).count() == 1, "Today returns to the current month")

    # add an event on the 15th
    cal.get_by_role("button", name=iso15).click()
    pg.wait_for_timeout(250)
    title = cal.get_by_label("Event title", exact=True)
    check(title.is_visible(), "clicking a day opens the new-event form")
    title.fill("Standup")
    cal.get_by_label("Event time", exact=True).fill("09:00")
    title.press("Enter")
    pg.wait_for_timeout(300)
    chip = cal.get_by_role("button", name="Standup")
    check(chip.count() == 1 and chip.is_visible(), "event chip visible in month view")
    check(cal.get_by_label("Event title", exact=True).count() == 0, "form closed after add")

    # click chip to edit / delete
    chip.click()
    pg.wait_for_timeout(250)
    check(cal.get_by_role("button", name="Delete event").count() == 1, "chip click opens edit/delete form")
    check(cal.get_by_label("Event title", exact=True).input_value() == "Standup", "edit form prefilled")
    cal.get_by_role("button", name="Cancel event").click()
    pg.wait_for_timeout(200)
    check(cal.get_by_role("button", name="Standup").count() == 1, "cancel keeps the event")

    # week view: cursor sits on the 15th after clicking that day
    cal.get_by_role("button", name="Week view").click()
    pg.wait_for_timeout(300)
    check(cal.locator("section").count() == 7, "week view shows 7 day columns")
    sec = f"{WD[d15.weekday()]} {d15.day} {cal_mod.month_abbr[d15.month]}"
    check(cal.locator(f"section[aria-label='{sec}']").get_by_role("button", name="Standup").count() == 1,
          f"event listed under its weekday column ({sec})")
    cal.get_by_role("button", name="Month view").click()
    pg.wait_for_timeout(300)
    check(cal.get_by_role("button", name="Standup").is_visible(), "event still visible back in month view")

    pg.wait_for_timeout(1800)
    saves = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "save_board"]
    cald = [t["data"] for t in saves[-1]["args"]["board"]["workspaces"][0].get("tiles", []) if t["kind"] == "calendar"] if saves else []
    evs = cald[-1]["events"] if cald else []
    check(
        bool(evs) and evs[0]["title"] == "Standup" and evs[0]["date"] == iso15 and evs[0].get("time") == "09:00",
        "calendar event persisted via save_board (survives reload)",
    )

    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/ab-webcal.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

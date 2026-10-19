#!/usr/bin/env python3
"""Web tile native browser (child WebView) — placement/visibility contract against the mock IPC.
Forces the native path with window.__nativeBrowser = true; the mock records browser_* calls."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def calls(pg, cmd):
    return [e["args"] for e in pg.evaluate("window.__ipcLog") if e["cmd"] == cmd]


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("window.__nativeBrowser = true; window.__autoConfirm = false;")
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    pg.get_by_role("button", name="Add tile").click()
    pg.get_by_role("menu", name="Add tile").get_by_role("menuitem", name="Web").click()
    pg.wait_for_timeout(500)
    web = pg.locator(".tile[data-kind='web']").last
    web.get_by_label("URL").fill("google.com")
    web.get_by_label("URL").press("Enter")
    pg.wait_for_timeout(600)

    check(web.locator("iframe").count() == 0, "no iframe in native mode")
    opens = calls(pg, "browser_open")
    navs = [c["url"] for c in calls(pg, "browser_navigate")]
    # a new web tile opens on its default URL, then the typed one is navigated to
    check(len(opens) == 1 and "https://google.com/" in [opens[0]["url"], *navs], f"opened once, then google.com ({opens[:1]}, {navs})")
    tile_id = opens[0]["tile"] if opens else ""
    host = web.locator("[data-native-browser]")
    check(host.count() == 1, "native host element rendered")
    check(web.get_by_role("button", name="Back").count() == 1 and web.get_by_role("button", name="Forward").count() == 1, "back/forward buttons")

    # bounds match the host element (logical px) and it is shown
    bb = host.bounding_box()
    sb = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id]
    last = sb[-1] if sb else None
    ok = last and last["visible"] and abs(last["rect"]["x"] - bb["x"]) < 1.5 and abs(last["rect"]["w"] - bb["width"]) < 1.5
    check(bool(ok), f"set_bounds follows host & visible ({last and last['rect']}, {bb})")

    # pan the canvas: bounds move with it
    n0 = len(calls(pg, "browser_set_bounds"))
    pane = pg.locator(".react-flow__pane").bounding_box()
    pg.mouse.move(pane["x"] + pane["width"] / 2, pane["y"] + 60)
    pg.mouse.wheel(-120, -60)  # panOnScroll
    pg.wait_for_timeout(500)
    sb2 = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id]
    bb2 = host.bounding_box()
    check(len(sb2) > len(sb) and abs(sb2[-1]["rect"]["x"] - bb2["x"]) < 1.5, "bounds update while panning")

    # zoom: page zoom follows canvas zoom
    pg.get_by_role("button", name="Zoom out").click()
    pg.wait_for_timeout(600)
    z = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id][-1]["zoom"]
    cz = pg.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a")
    check(abs(z - cz) < 0.01, f"webview zoom = canvas zoom ({z:.3f} vs {cz:.3f})")
    pg.get_by_role("button", name="Fit view").click(); pg.wait_for_timeout(600)

    # covered by a menu → hidden; closed → shown again
    web.get_by_role("button", name="Tile options").click()
    pg.wait_for_timeout(300)
    # the … menu sits over the top-right of the body → native view must hide
    vis = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id][-1]["visible"]
    covered = host.get_attribute("data-native-browser") == "hidden"
    check((not vis) == covered, f"visibility reported consistently (visible={vis}, host={host.get_attribute('data-native-browser')})")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # modal over everything → hidden
    pg.get_by_role("button", name="Pause all").click(); pg.wait_for_timeout(500)
    last = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id][-1]
    check(last["visible"] is False, "hidden while a modal covers it")
    pg.get_by_role("dialog", name="Pause all").get_by_role("button", name="Cancel").click()
    pg.wait_for_timeout(600)
    last = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id][-1]
    check(last["visible"] is True, "shown again after modal closes")

    # nav event from the native view updates the address bar
    pg.evaluate(f"window.__mock.emit('browser://nav', {{tile: '{tile_id}', url: 'https://www.google.com/search?q=x', loading: false}})")
    pg.wait_for_timeout(200)
    check(web.get_by_label("URL").input_value() == "https://www.google.com/search?q=x", "address bar follows navigation")

    # navigate + back + reload
    web.get_by_label("URL").fill("localhost:5173")
    web.get_by_label("URL").press("Enter"); pg.wait_for_timeout(300)
    check(any(c["url"] == "http://localhost:5173/" for c in calls(pg, "browser_navigate")), "browser_navigate localhost")
    web.get_by_role("button", name="Back").click()
    web.get_by_role("button", name="Reload").click(); pg.wait_for_timeout(200)
    acts = [c["action"] for c in calls(pg, "browser_action")]
    check("back" in acts, f"back action ({acts})")

    # device preset → zoom includes preset scale
    web.get_by_role("button", name="Tile options").click()
    pg.get_by_role("button", name="iPhone 15 Pro").click(); pg.wait_for_timeout(700)
    last = [c for c in calls(pg, "browser_set_bounds") if c["tile"] == tile_id][-1]
    cz = pg.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a")
    css_w = last["rect"]["w"] / last["zoom"]
    check(abs(css_w - 393) < 4, f"device preset lays out at 393 CSS px ({css_w:.1f})")

    # remove tile → close
    web.get_by_role("button", name="Tile options").click()
    pg.get_by_role("button", name="Remove tile").click(); pg.wait_for_timeout(800)
    check(any(c["tile"] == tile_id for c in calls(pg, "browser_close")), "browser_close on remove")

    pg.screenshot(path="/tmp/ab-browser.png")
    check(not errors, "No page errors: " + ("; ".join(errors[:3]) or "clean"))
    b.close()

print(f"RESULT {'PASS' if not fails else 'FAIL'} {len(fails)}")
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Phase 8C UI: canvas sections — create via radial, rename, adopt tile by drag, move section moves members, release, remove keep contents."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5311/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def drag(pg, frm, to, steps=14):
    pg.mouse.move(*frm)
    pg.mouse.down()
    pg.mouse.move(frm[0] + 1, frm[1] + 1)  # first move only arms the drag (xyflow)
    pg.wait_for_timeout(60)
    pg.mouse.move(frm[0] + 6, frm[1] + 6)
    pg.wait_for_timeout(60)
    pg.mouse.move(*to, steps=steps)
    pg.wait_for_timeout(120)
    pg.mouse.up()
    pg.wait_for_timeout(450)


def center(b):
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = false")  # real in-app dialog

    # pan the board left so the right side is empty
    pane = pg.locator(".react-flow__pane")
    bb = pane.bounding_box()
    # v0.1.4: the wheel zooms (no panOnScroll) — zoom out around the top-left corner so the
    # board shrinks there and the right / bottom of the canvas is empty
    pg.mouse.move(bb["x"] + 20, bb["y"] + 20)
    for _ in range(4):
        pg.mouse.wheel(0, 400)
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(500)

    # a loose note tile, away from where the section goes
    pg.mouse.click(1350, 820, button="right")
    pg.wait_for_timeout(400)
    pg.get_by_role("menu", name="Radial context menu").get_by_role("menuitem", name="+ Note").click()
    pg.wait_for_timeout(900)
    tile = pg.locator(".tile[data-kind='note']").last
    check(tile.count() == 1, "note tile created")
    # park it bottom-right (new tiles land at viewport centre)
    hb = tile.locator(".tile-header").bounding_box()
    drag(pg, (hb["x"] + 60, hb["y"] + 10), (1300, 760))

    # ---- create section from radial
    pg.mouse.click(560, 400, button="right")
    pg.wait_for_timeout(400)
    radial = pg.get_by_role("menu", name="Radial context menu")
    check(radial.get_by_role("menuitem").count() == 9, "radial has 9 items")
    radial.get_by_role("menuitem", name="+ Section").click()
    pg.wait_for_timeout(600)
    sec = pg.locator(".section-frame")
    check(sec.count() == 1, "section created")
    check(pg.locator(".section-name").first.inner_text().strip().lower() == "section 1", "default name 'Section 1'")
    sb = sec.bounding_box()
    check(abs(sb["width"] / sb["height"] - 1.5) < 0.02, "default 900x600 aspect")
    check(abs(center(sb)[0] - 560) < 8 and abs(center(sb)[1] - 400) < 8, "centered on click point")
    z = pg.evaluate("parseInt(getComputedStyle(document.querySelector('.react-flow__node-section')).zIndex)")
    check(z < 0, f"section z-index below others ({z})")

    # ---- rename (double-click)
    pg.locator(".section-name").dblclick()
    inp = pg.get_by_label("Section name")
    inp.fill("Backend")
    inp.press("Enter")
    pg.wait_for_timeout(300)
    check(pg.locator(".section-name").first.inner_text().strip().lower() == "backend", "rename via double-click")

    # ---- interior pans the canvas (pointer-events none on body)
    vp0 = pg.locator(".react-flow__viewport").evaluate("e => e.style.transform")
    cx, cy = center(sb)
    drag(pg, (cx, cy + 80), (cx - 60, cy + 110))
    vp1 = pg.locator(".react-flow__viewport").evaluate("e => e.style.transform")
    check(vp0 != vp1, "dragging empty interior pans the canvas")
    sb = sec.bounding_box()

    # ---- drag tile in
    t0 = tile.bounding_box()
    hb = tile.locator(".tile-header").bounding_box()
    cx, cy = center(sb)
    drag(pg, (hb["x"] + t0["width"] / 2 - 20, hb["y"] + hb["height"] / 2), (cx - 20, cy - t0["height"] / 2 + hb["height"] / 2))
    t1 = tile.bounding_box()
    check(abs(center(t1)[0] - cx) < 14 and abs(center(t1)[1] - cy) < 14, "tile dragged into the section")

    # ---- move section → tile follows by the same delta
    sb = sec.bounding_box()
    sh = pg.locator(".section-header").bounding_box()
    t_before = tile.bounding_box()
    dx, dy = -120, 70
    drag(pg, (sh["x"] + 14, sh["y"] + sh["height"] / 2), (sh["x"] + 14 + dx, sh["y"] + sh["height"] / 2 + dy))
    sb2 = sec.bounding_box()
    t_after = tile.bounding_box()
    check(abs((sb2["x"] - sb["x"]) - dx) < 3 and abs((sb2["y"] - sb["y"]) - dy) < 3, "section moved by drag delta")
    check(abs((t_after["x"] - t_before["x"]) - dx) < 3 and abs((t_after["y"] - t_before["y"]) - dy) < 3, "tile moved by the same delta")

    # ---- drag tile out → leaves; section move no longer moves it
    hb = tile.locator(".tile-header").bounding_box()
    drag(pg, (hb["x"] + 40, hb["y"] + hb["height"] / 2), (1300, 780))
    t_out = tile.bounding_box()
    tcx, tcy = center(t_out)
    inside = sb2["x"] < tcx < sb2["x"] + sb2["width"] and sb2["y"] < tcy < sb2["y"] + sb2["height"]
    check(not inside, "tile dragged outside the section")
    sh = pg.locator(".section-header").bounding_box()
    drag(pg, (sh["x"] + 14, sh["y"] + sh["height"] / 2), (sh["x"] + 14 + 80, sh["y"] + sh["height"] / 2))
    t_out2 = tile.bounding_box()
    check(abs(t_out2["x"] - t_out["x"]) < 2 and abs(t_out2["y"] - t_out["y"]) < 2, "released tile no longer follows section")

    # ---- re-adopt, then remove section keeping contents
    sb = sec.bounding_box()
    hb = tile.locator(".tile-header").bounding_box()
    t0 = tile.bounding_box()
    cx, cy = center(sb)
    drag(pg, (hb["x"] + t0["width"] / 2 - 20, hb["y"] + hb["height"] / 2), (cx - 20, cy - t0["height"] / 2 + hb["height"] / 2))
    tin = tile.bounding_box()
    pg.get_by_role("button", name="Section menu").click()
    pg.wait_for_timeout(300)
    pg.get_by_role("menuitem", name="Remove section (keep contents)").click()
    pg.wait_for_timeout(500)
    dlg = pg.get_by_role("dialog", name="Remove section")
    check(dlg.count() == 1, "in-app confirm dialog shown")
    dlg.get_by_role("button").last.click()
    pg.wait_for_timeout(900)
    check(pg.locator(".section-frame").count() == 0, "section removed")
    check(pg.locator(".tile[data-kind='note']").count() == 1, "tile kept after removing section")
    tafter = tile.bounding_box()
    check(abs(tafter["x"] - tin["x"]) < 2 and abs(tafter["y"] - tin["y"]) < 2, "kept tile did not move")

    # ---- new section with the destructive menu entry
    pg.mouse.click(560, 400, button="right")
    pg.wait_for_timeout(400)
    pg.get_by_role("menu", name="Radial context menu").get_by_role("menuitem", name="+ Section").click()
    pg.wait_for_timeout(600)
    check(pg.locator(".section-name").first.inner_text().strip().lower() == "section 1", "numbering restarts when no sections remain")
    pg.get_by_role("button", name="Section menu").click()
    pg.wait_for_timeout(300)
    check(pg.get_by_role("menuitem", name="Remove section + contents").count() == 1, "menu has 'Remove section + contents'")
    pg.keyboard.press("Escape")

    check(not errors, "no page errors: " + "; ".join(errors[:3]))
    b.close()

print(f"RESULT: {'FAIL' if fails else 'OK'} ({len(fails)} fails)")
sys.exit(1 if fails else 0)

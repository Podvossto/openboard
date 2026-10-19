#!/usr/bin/env python3
"""Tiles smoke: add each tile kind from the rail and exercise it (mock IPC)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1423/"
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

    # note
    note = add(pg, "Note")
    check(note.count() == 1, "note tile added")
    note.get_by_label("Note text").fill("remember the API key rotation")
    # note debounce 400ms + autosave debounce — poll instead of a fixed sleep (CI load)
    try:
        pg.wait_for_function("(window.__ipcLog||[]).some(e => e.cmd === 'save_board' && JSON.stringify(e.args).includes('remember the API key rotation'))", timeout=6000)
    except Exception:
        pass
    saves = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "save_board"]
    import json as _j
    check(bool(saves) and "remember the API key rotation" in _j.dumps(saves[-1]["args"]), "note text saved via save_board")

    # checklist
    cl = add(pg, "Checklist")
    inp = cl.get_by_label("New checklist item")
    for t in ["write tests", "update docs", "ship"]:
        inp.fill(t)
        inp.press("Enter")
    cl.get_by_role("checkbox", name="write tests").click()
    check(cl.get_by_text("1/3").count() == 1, "checklist progress 1/3")

    # kanban: add card + drag to Done
    kb = add(pg, "Kanban")
    kb.locator("section[aria-label='Column To do']").get_by_label("New card").fill("login page")
    kb.locator("section[aria-label='Column To do']").get_by_label("New card").press("Enter")
    card = kb.locator("article", has_text="login page")
    try:
        card.wait_for(timeout=3000)
    except Exception:
        pass
    check(card.count() == 1, "kanban card added")
    card.drag_to(kb.locator("section[aria-label='Column Done']"))
    pg.wait_for_timeout(300)
    check(kb.locator("section[aria-label='Column Done'] article", has_text="login page").count() == 1, "kanban card dragged to Done")

    # web
    web = add(pg, "Web")
    web.get_by_label("URL").fill("localhost:1423")
    web.get_by_label("URL").press("Enter")
    pg.wait_for_timeout(500)
    src = web.locator("iframe").get_attribute("src")
    check(src == "http://localhost:1423/", f"web tile iframe src normalized ({src})")

    # git (tabbed card: stage checkbox + commit on Changes)
    git = add(pg, "Git")
    pg.wait_for_timeout(500)
    check(git.get_by_text("dev", exact=True).count() >= 1, "git card shows branch")
    git.get_by_role("checkbox", name="Stage notes.md").click()
    pg.wait_for_timeout(300)
    git.get_by_label("Commit message").fill("wip")
    git.get_by_role("button", name="Commit", exact=True).click()
    pg.wait_for_timeout(400)
    log = pg.evaluate("window.__ipcLog")
    check(any(e["cmd"] == "git_stage" and e["args"].get("paths") == ["notes.md"] for e in log), "git stage invoked")
    check(any(e["cmd"] == "git_commit" and e["args"].get("message") == "wip" for e in log), "git commit invoked")

    # remove a tile
    note.hover()
    note.get_by_role("button", name="Tile options").click()
    pg.get_by_role("button", name="Remove tile").click()
    try:
        pg.wait_for_function("document.querySelectorAll(\".tile[data-kind='note']\").length === 0", timeout=3000)
    except Exception:
        pass
    check(pg.locator(".tile[data-kind='note']").count() == 0, "tile removed")

    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/ab-tiles.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

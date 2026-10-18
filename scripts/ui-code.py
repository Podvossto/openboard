#!/usr/bin/env python3
"""Code studio: tree → open → highlighted editor → edit → Ctrl+S → pin to board (mock IPC)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1434/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)

    # open via rail button
    pg.get_by_role("button", name="Code", exact=True).click()
    dlg = pg.get_by_role("dialog", name="Code studio")
    dlg.wait_for(timeout=8000)
    check(dlg.count() == 1, "Code studio opens from rail")
    tree = dlg.get_by_role("tree", name="Files")
    tree.get_by_role("treeitem", name="src", exact=True).wait_for(timeout=5000)
    names = [t.get_attribute("aria-label") for t in tree.get_by_role("treeitem").all()]
    check(names[:2] == ["assets", "src"] and "package.json" in names, f"tree lists dirs first: {names}")

    # expand src, open main.ts
    tree.get_by_role("treeitem", name="src", exact=True).click()
    tree.get_by_role("treeitem", name="main.ts").wait_for(timeout=3000)
    check(tree.get_by_role("treeitem", name="styles").count() == 1, "src expanded lazily")
    tree.get_by_role("treeitem", name="main.ts").click()
    content = dlg.locator(".cm-content")
    content.wait_for(timeout=5000)
    pg.wait_for_timeout(300)
    check("hello mock" in content.inner_text(), "editor shows file text")
    check(dlg.locator(".cm-content span[class]").count() > 3, "syntax highlighting spans present")
    check("TypeScript" in dlg.get_by_label("Status bar").inner_text(), "status bar shows language")

    # filter
    dlg.get_by_label("Filter files").fill("main")
    pg.wait_for_timeout(150)
    check(tree.get_by_role("treeitem", name="util.ts").count() == 0, "filter hides non-matching")
    dlg.get_by_label("Filter files").fill("")

    # edit + save
    content.click()
    pg.keyboard.press("Control+End")
    pg.keyboard.type("// edited-by-test")
    pg.wait_for_timeout(200)
    check(dlg.get_by_test_id("dirty-dot").count() == 1, "dirty dot shown after edit")
    check("Ln 5" in dlg.get_by_label("Status bar").inner_text() or "Ln 6" in dlg.get_by_label("Status bar").inner_text(), "cursor line:col updates")
    pg.keyboard.press("Control+s")
    pg.wait_for_timeout(300)
    writes = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "fs_write"]
    check(bool(writes) and "edited-by-test" in writes[-1]["args"]["text"] and writes[-1]["args"]["rel"] == "src/main.ts", "Ctrl+S sent fs_write with new text")
    check(dlg.get_by_test_id("dirty-dot").count() == 0, "dirty dot cleared after save")

    # binary file
    tree.get_by_role("treeitem", name="assets").click()
    tree.get_by_role("treeitem", name="logo.bin").click()
    check(dlg.get_by_text("Binary file").count() == 1, "binary file shows message")
    dlg.get_by_role("tab", name="main.ts").click()

    # traversal not possible from UI/backend mock
    res = pg.evaluate("""async () => {
      const inv = window.__TAURI_INTERNALS__.invoke;
      const out = [];
      for (const rel of ['../x', '/etc/passwd', 'a/../../b']) {
        try { await inv('fs_read', { root: 'C:/dev', rel }); out.push('ok'); } catch (e) { out.push('err'); }
      }
      return out;
    }""")
    check(res == ["err", "err", "err"], "traversal rejected")

    # pin to board
    dlg.get_by_role("button", name="Pin to board").click()
    pg.wait_for_timeout(500)
    # close panel
    dlg.get_by_role("button", name="Close code studio").click()
    try:
        pg.get_by_role("dialog", name="Code studio").wait_for(state="detached", timeout=5000)
    except Exception:
        pass
    check(pg.get_by_role("dialog", name="Code studio").count() == 0, "panel closes")
    tile = pg.locator(".tile[data-kind='code']")
    check(tile.count() == 1, "code tile on board")
    tile.locator(".cm-content").wait_for(timeout=5000)
    check("edited-by-test" in tile.locator(".cm-content").inner_text(), "tile shows saved preview")
    check(tile.get_by_text("src/main.ts").count() >= 1, "tile shows file path")

    # double-click tile → opens in studio at that file
    tile.locator(".cm-content").dblclick()
    dlg.wait_for(timeout=8000)
    dlg.locator(".cm-content").wait_for(timeout=5000)
    pg.wait_for_timeout(400)
    check(dlg.get_by_role("tab", name="main.ts").count() == 1 and "edited-by-test" in dlg.locator(".cm-content").inner_text(), "dblclick tile opens file in studio")
    pg.keyboard.press("Escape")
    try:
        pg.get_by_role("dialog", name="Code studio").wait_for(state="detached", timeout=5000)
    except Exception:
        pass
    check(pg.get_by_role("dialog", name="Code studio").count() == 0, "Esc closes")

    # shortcut
    pg.locator(".react-flow__pane").click(position={"x": 600, "y": 700})
    pg.keyboard.press("Control+Shift+E")
    pg.get_by_role("dialog", name="Code studio").wait_for(timeout=8000)
    check(True, "Ctrl+Shift+E opens studio")

    check(not errors, f"no page errors {errors[:2]}")
    b.close()

print("RESULT", "FAIL" if fails else "OK", len(fails), "failed")
sys.exit(1 if fails else 0)

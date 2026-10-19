#!/usr/bin/env python3
"""v0.1.2 checks (mock IPC): top bar without Back-to-home / project button, Shift+drag
multi-select → selection bar → Delete, Z.ai profile shows GLM models (not Opus/Sonnet/Haiku),
provider model ids under Advanced, CLI logos + Install button."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5316/"
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

    # ---- top bar cleanup
    check(pg.get_by_title("Back to home").count() == 0, "Back to home button removed")
    check(pg.locator("header.topbar").get_by_title("Project folder", exact=False).count() == 0, "project/Agent Board button removed")
    check(pg.get_by_role("button", name="Settings").count() >= 1, "Settings button still there")

    # ---- Shift+drag box selection over the board
    n_before = pg.locator(".react-flow__node").count()
    pane = pg.locator(".react-flow__pane").bounding_box()
    pg.keyboard.down("Shift")
    pg.mouse.move(pane["x"] + 5, pane["y"] + 5)
    pg.mouse.down()
    pg.mouse.move(pane["x"] + pane["width"] - 5, pane["y"] + pane["height"] - 5, steps=12)
    pg.mouse.up()
    pg.keyboard.up("Shift")
    pg.wait_for_timeout(400)
    bar = pg.get_by_role("toolbar", name="Selection")
    check(bar.count() == 1, "selection bar appears after Shift+drag")
    cnt = bar.locator("[data-testid=sel-count]").inner_text() if bar.count() else ""
    check("console" in cnt, f"selection bar summarizes ({cnt!r})")
    check(bar.get_by_role("button", name="Group").count() == 1, "Group offered for consoles")

    # Delete → confirm dialog (running consoles) → nodes gone
    pg.evaluate("window.__autoConfirm = false")
    bar.get_by_role("button", name="Delete").click()
    dlg = pg.get_by_role("dialog", name="Delete selection")
    dlg.wait_for(timeout=3000)
    check("will stop" in dlg.inner_text(), "warns that running consoles will stop")
    dlg.get_by_role("button", name="OK").click()
    pg.wait_for_timeout(900)
    n_after = pg.locator(".react-flow__node").count()
    check(n_after < n_before, f"selected nodes deleted ({n_before} → {n_after})")
    kills = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "kill_console"]
    check(len(kills) >= 1, "running consoles were killed")
    check(pg.get_by_role("toolbar", name="Selection").count() == 0, "bar hides after delete")

    # Esc on a plain page must not delete anything / plain drag still pans (no box)
    pg.mouse.move(pane["x"] + 200, pane["y"] + 200)
    pg.mouse.down()
    pg.mouse.move(pane["x"] + 400, pane["y"] + 300, steps=6)
    pg.mouse.up()
    pg.wait_for_timeout(200)
    check(pg.locator(".react-flow__selection").count() == 0, "plain drag does not box-select")
    pg.close()

    # ---- Z.ai profile → GLM model choices
    pg = b.new_page(viewport={"width": 1700, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script("""
      window.__seedProfiles = [{ id: 'prof-zai', name: 'Z.ai', cli: 'claude', color: '#5fd4a8',
        kind: { type: 'provider', provider: 'zai', baseUrl: 'https://api.z.ai/api/anthropic', model: 'glm-5.3[1m]', smallModel: 'glm-5.3-flash[1m]' } }];
    """)
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(700)
    pg.keyboard.press("Control+Shift+N")
    modal = pg.get_by_role("dialog").filter(has_text="Console Name")
    modal.wait_for(timeout=3000)
    models = modal.get_by_role("radiogroup", name="Model")
    labels = models.get_by_role("radio").all_inner_texts()
    check("Opus" in labels, f"default profile offers Claude models ({labels})")
    modal.locator("select").select_option("prof-zai")
    pg.wait_for_timeout(200)
    labels = models.get_by_role("radio").all_inner_texts()
    check(not any(x in labels for x in ("Opus", "Sonnet", "Haiku")), f"Z.ai hides Opus/Sonnet/Haiku ({labels})")
    check(any("GLM-5.3" in x for x in labels), "Z.ai offers GLM models")
    check(any("Flash" in x for x in labels), "Z.ai offers GLM Flash")
    models.get_by_role("radio", name="GLM-5.3 Flash · 1M").click()
    modal.get_by_role("button", name="Create Console").click()
    pg.wait_for_timeout(1200)
    spawns = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "spawn_console"]
    last = spawns[-1]["args"] if spawns else {}
    req = last.get("args", last)
    check(req.get("profile") == "prof-zai" and req.get("model") == "glm-5.3-flash[1m]", f"console spawned with Z.ai + GLM Flash ({req.get('profile')}, {req.get('model')})")

    # ---- Settings: Advanced model ids + CLI logos/Install
    pg.locator("button[aria-label='Settings']").first.click()
    sheet = pg.get_by_role("dialog", name="Settings")
    sheet.wait_for(timeout=3000)
    sheet.get_by_role("tab", name="Providers & Accounts").click()
    pg.wait_for_timeout(300)
    adv = sheet.locator("[data-testid=profile-advanced]").first
    check(adv.count() == 1 and not adv.get_by_label("Model", exact=True).is_visible(), "model ids collapsed under Advanced")
    adv.locator("summary").click()
    check(adv.get_by_label("Model", exact=True).input_value() == "glm-5.3[1m]", "Advanced shows the preset model id")

    sheet.get_by_role("tab", name="Agents").click()
    pg.wait_for_timeout(500)
    check(sheet.locator("[data-catalog=gemini] img[data-logo=gemini]").count() == 1, "Gemini shows its logo")
    check(sheet.locator("[data-catalog=aider] img").count() == 0, "Aider (no devicon) keeps the letter tile")
    check(sheet.locator("[data-catalog=gemini]").get_by_text("Installed").count() == 1, "installed CLI marked Installed")
    check(sheet.locator("[data-catalog=cursor]").get_by_role("link", name="Install Cursor CLI (opens docs)").count() == 1, "URL-only CLI gets an install guide link")
    btn = sheet.get_by_role("button", name="Install Qwen Code")
    check(btn.count() == 1, "missing CLI gets an Install button")
    btn.click()
    pg.wait_for_timeout(700)
    spawns = [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == "spawn_console"]
    req = spawns[-1]["args"].get("args", spawns[-1]["args"]) if spawns else {}
    ag = req.get("agent", {})
    check(ag.get("kind") == "custom" and ag.get("program") == "cmd" and "npm i -g @qwen-code/qwen-code" in " ".join(ag.get("args", [])), f"Install runs the npm command in a console ({ag})")
    check(pg.locator(".react-flow__node").filter(has_text="install Qwen Code").count() == 1, "install console appears on the board")
    pg.screenshot(path="/tmp/ab-v012.png")

    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

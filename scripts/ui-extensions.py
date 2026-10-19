#!/usr/bin/env python3
"""Skills & MCP panel: rail entries, list, create/delete skill, add/remove MCP server (mock IPC)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5312/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def ipc(pg, cmd):
    return [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == cmd]


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = false")

    # ---- open from rail
    check(pg.get_by_role("button", name="Skills", exact=True).count() == 1, "rail has Skills")
    check(pg.get_by_role("button", name="MCP", exact=True).count() == 1, "rail has MCP")
    pg.get_by_role("button", name="Skills", exact=True).click()
    dlg = pg.get_by_role("dialog", name="Skills and MCP")
    dlg.wait_for()
    pg.wait_for_timeout(500)
    check(dlg.get_by_role("tab", name="Skills", selected=True).count() == 1, "opens on Skills tab")
    cards = dlg.get_by_test_id("skill-card")
    check(cards.count() == 3, f"3 claude skills listed ({cards.count()})")
    check(dlg.get_by_text("pdf-tools").count() >= 1, "skill name shown")
    ls = ipc(pg, "list_skills")[-1]["args"]
    check(ls["cli"] == "claude" and ls["cwd"] == "C:/Users/dev", f"list_skills args {ls}")

    # search + scope filter
    dlg.get_by_label("Search skills").fill("review")
    check(cards.count() == 1, "search filters skills")
    dlg.get_by_label("Search skills").fill("")
    dlg.get_by_role("radiogroup", name="Scope filter").get_by_role("radio", name="Project").click()
    check(cards.count() == 1, "project scope filter")
    dlg.get_by_role("radiogroup", name="Scope filter").get_by_role("radio", name="All").click()

    # ---- create skill
    dlg.get_by_role("button", name="New skill").click()
    form = dlg.get_by_role("form", name="New skill")
    form.get_by_label("Name").fill("Bad Name!")
    form.get_by_label("Name").blur()
    check(form.get_by_label("Name").input_value() == "bad-name", "name slugified on blur")
    form.get_by_label("Name").fill("my-new-skill")
    form.get_by_role("button", name="Create skill").click()
    check(form.get_by_role("alert").count() == 1, "description required error")
    form.get_by_label("Description").fill("Does a thing")
    form.get_by_label("Instructions (markdown)").fill("# Steps\n1. go")
    form.get_by_role("button", name="Create skill").click()
    pg.wait_for_timeout(400)
    c = ipc(pg, "create_skill")
    check(len(c) == 1 and c[0]["args"]["name"] == "my-new-skill" and c[0]["args"]["scope"] == "user"
          and c[0]["args"]["description"] == "Does a thing" and c[0]["args"]["body"].startswith("# Steps")
          and c[0]["args"]["cli"] == "claude", f"create_skill args {c}")
    check(cards.count() == 4 and dlg.get_by_text("my-new-skill").count() >= 1, "new skill appears")

    # ---- delete with in-app confirm (cancel then OK)
    dlg.get_by_role("button", name="Delete my-new-skill").click()
    pg.wait_for_timeout(400)
    cd = pg.get_by_role("dialog").filter(has_text="Delete skill").last
    check(cd.count() == 1, "in-app confirm shown")
    cd.get_by_role("button", name="Cancel").click()
    pg.wait_for_timeout(400)
    check(len(ipc(pg, "delete_skill")) == 0 and cards.count() == 4, "cancel keeps skill")
    check(dlg.count() == 1, "panel still open after cancel")
    dlg.get_by_role("button", name="Delete my-new-skill").click()
    pg.wait_for_timeout(400)
    pg.get_by_role("dialog").filter(has_text="Delete skill").last.get_by_role("button", name="Delete", exact=True).click()
    pg.wait_for_timeout(500)
    d = ipc(pg, "delete_skill")
    check(len(d) == 1 and d[0]["args"]["name"] == "my-new-skill" and d[0]["args"]["scope"] == "user", f"delete_skill args {d}")
    check(cards.count() == 3, "skill removed from list")

    # ---- CLI switch → Codex prompts
    dlg.get_by_role("radiogroup", name="CLI").get_by_role("radio", name="Codex").click()
    pg.wait_for_timeout(400)
    check(cards.count() == 1 and dlg.get_by_text("prompt", exact=True).count() == 1, "codex prompts listed read-only")
    check(dlg.get_by_role("button", name="Delete review").count() == 0, "no delete on prompts")
    dlg.get_by_role("radiogroup", name="CLI").get_by_role("radio", name="Claude Code").click()

    # ---- MCP tab
    dlg.get_by_role("tab", name="MCP servers").click()
    pg.wait_for_timeout(400)
    mc = dlg.get_by_test_id("mcp-card")
    check(mc.count() == 3, f"3 claude MCP servers ({mc.count()})")
    check(dlg.get_by_text("npx -y @upstash/context7-mcp").count() == 1, "stdio command shown")
    check(dlg.get_by_text("https://mcp.linear.app/mcp").count() == 1, "http url shown")
    check(dlg.get_by_text("env: API_KEY").count() == 1, "env keys only")

    # add http server (+ env row with password input)
    dlg.get_by_role("button", name="Add server").first.click()
    f = dlg.get_by_role("form", name="Add MCP server")
    f.get_by_label("Name").fill("notion")
    f.get_by_role("radiogroup", name="Transport").get_by_role("radio", name="http").click()
    f.get_by_label("URL").fill("https://mcp.notion.com/mcp")
    f.get_by_role("button", name="+ Env variable").click()
    f.get_by_label("Env name 1").fill("NOTION_TOKEN")
    check(f.get_by_label("Env value 1").get_attribute("type") == "password", "env value is a password input")
    f.get_by_label("Env value 1").fill("s3cret")
    f.get_by_role("button", name="Add server").click()
    pg.wait_for_timeout(500)
    a = ipc(pg, "add_mcp")
    sv = a[0]["args"]["server"] if a else {}
    check(len(a) == 1 and sv.get("name") == "notion" and sv.get("transport") == "http"
          and sv.get("url") == "https://mcp.notion.com/mcp" and sv.get("env") == [["NOTION_TOKEN", "s3cret"]]
          and sv.get("scope") == "user" and a[0]["args"]["cli"] == "claude", f"add_mcp args {a}")
    check(mc.count() == 4, "new server listed")
    check("s3cret" not in dlg.inner_text(), "secret value not rendered")

    # failure shows CLI stderr inline
    dlg.get_by_role("button", name="Add server").first.click()
    f = dlg.get_by_role("form", name="Add MCP server")
    f.get_by_label("Name").fill("fail")
    f.get_by_label("Command and arguments").fill("node x.js")
    f.get_by_role("button", name="Add server").click()
    pg.wait_for_timeout(400)
    check("already exists" in (f.get_by_role("alert").inner_text() if f.get_by_role("alert").count() else ""), "stderr shown inline on failure")
    # validation error without IPC
    n = len(ipc(pg, "add_mcp"))
    f.get_by_label("Name").fill("bad name")
    f.get_by_role("button", name="Add server").click()
    check(len(ipc(pg, "add_mcp")) == n, "invalid form does not call IPC")
    dlg.get_by_role("button", name="Add server").first.click()  # collapse

    # remove with confirm
    dlg.get_by_role("button", name="Remove notion").click()
    pg.wait_for_timeout(400)
    pg.get_by_role("dialog").filter(has_text="Remove MCP server").last.get_by_role("button", name="Remove", exact=True).click()
    pg.wait_for_timeout(500)
    r = ipc(pg, "remove_mcp")
    check(len(r) == 1 and r[0]["args"]["name"] == "notion" and r[0]["args"]["scope"] == "user", f"remove_mcp args {r}")
    check(mc.count() == 3, "server removed")

    # Esc closes; top-bar toolbox + rail MCP reopen on right tab
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(1000)
    check(pg.get_by_role("dialog", name="Skills and MCP").count() == 0, "Esc closes panel")
    pg.get_by_role("button", name="MCP", exact=True).click()
    pg.get_by_role("dialog", name="Skills and MCP").wait_for()
    check(pg.get_by_role("tab", name="MCP servers", selected=True).count() == 1, "rail MCP opens MCP tab")
    pg.get_by_role("button", name="Close skills and MCP").click()
    pg.wait_for_timeout(500)
    pg.get_by_role("button", name="Skills & MCP").click()
    pg.get_by_role("dialog", name="Skills and MCP").wait_for()
    check(pg.get_by_role("dialog", name="Settings").count() == 0, "top-bar toolbox opens Skills & MCP (not Settings)")
    pg.screenshot(path="/tmp/ui-extensions.png")

    check(not errors, f"no page errors {errors[:3]}")
    b.close()

print(f"RESULT {'FAIL' if fails else 'PASS'} ({len(fails)} failed)")
sys.exit(1 if fails else 0)

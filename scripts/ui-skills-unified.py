#!/usr/bin/env python3
"""Unified Skills list (mock IPC): one list across CLIs, source badges, search, drag-drop .md install, MCP keeps CLI selector."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5319/"
fails, errors = [], []


def check(ok, name):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


def ipc(pg, cmd):
    return [e for e in pg.evaluate("window.__ipcLog") if e["cmd"] == cmd]


DROP = """([files, phase]) => {
  const dlg = document.querySelector('[role=dialog][aria-label="Skills and MCP"]');
  const dt = new DataTransfer();
  for (const [n, t] of files) dt.items.add(new File([t], n, { type: 'text/markdown' }));
  const fire = (t) => dlg.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  if (phase === 'enter') { fire('dragenter'); fire('dragover'); window.__dt = dt; return true; }
  fire('drop');
  return true;
}"""

SKILL_MD = "---\nname: dropped-skill\ndescription: Installed by drag and drop\n---\n\n# Dropped\nDo the thing.\n"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
    pg.goto(URL)
    pg.wait_for_selector(".ring-pill")
    pg.wait_for_timeout(900)
    pg.evaluate("window.__autoConfirm = false")

    pg.get_by_role("button", name="Skills & MCP").first.click()
    dlg = pg.get_by_role("dialog", name="Skills and MCP")
    dlg.wait_for()
    pg.wait_for_timeout(600)
    check(dlg.get_by_role("tab", name="Skills", selected=True).count() == 1, "opens on Skills tab")
    check(dlg.get_by_role("radiogroup", name="CLI").count() == 0, "no CLI radiogroup in Skills tab")
    check(dlg.get_by_label("Account").count() == 0, "no Account select in Skills tab")

    cards = dlg.get_by_test_id("skill-card")
    check(cards.count() == 4, f"4 skills (3 claude + 1 codex) in one list ({cards.count()})")
    pdf = cards.filter(has_text="pdf-tools")
    check(pdf.count() == 1 and pdf.get_by_text("Claude Code", exact=True).count() == 1, "claude skill has Claude Code badge")
    rev = cards.filter(has_text="Review the current changes")
    check(rev.count() == 1 and rev.get_by_text("Codex", exact=True).count() == 1, "codex prompt has Codex badge")
    check(pdf.get_by_text("user", exact=True).count() == 1, "scope badge kept")
    cliset = {e["args"]["cli"] for e in ipc(pg, "list_skills")}
    check(cliset == {"claude", "codex"}, f"list_skills called for both CLIs {cliset}")

    s = dlg.get_by_label("Search skills")
    s.fill("review")
    check(cards.count() == 2, f"search 'review' matches code-review + codex review ({cards.count()})")
    s.fill("codex")
    check(cards.count() == 1, "search matches source label")
    s.fill("")

    # install-to chips
    grp = dlg.get_by_role("group", name="Install to")
    check(grp.get_by_role("checkbox", name="Install to Claude Code").get_attribute("aria-checked") == "true", "Install to defaults to Claude Code")
    check(grp.get_by_role("checkbox", name="Install to Codex").get_attribute("aria-checked") == "false", "Codex not checked by default")

    # drag-drop: overlay, confirm, install
    files = [["SKILL.md", SKILL_MD], ["notes.txt", "nope"]]
    pg.evaluate(DROP, [files, "enter"])
    pg.wait_for_timeout(200)
    check(dlg.get_by_test_id("skill-drop-overlay").count() == 1 and "Drop SKILL.md / .md files to install" in dlg.get_by_test_id("skill-drop-overlay").inner_text(), "drop overlay shown on dragenter")
    pg.evaluate(DROP, [files, "drop"])
    pg.wait_for_timeout(500)
    cd = pg.get_by_role("dialog").filter(has_text="Install skills").last
    check(cd.count() == 1 and "dropped-skill" in cd.inner_text() and "Claude Code" in cd.inner_text(), "confirm dialog lists skill + target")
    cd.get_by_role("button", name="Install").click()
    pg.wait_for_timeout(700)
    c = ipc(pg, "create_skill")
    check(len(c) == 1 and c[0]["args"]["name"] == "dropped-skill" and c[0]["args"]["description"] == "Installed by drag and drop"
          and c[0]["args"]["body"].startswith("# Dropped") and c[0]["args"]["cli"] == "claude", f"create_skill args {c}")
    check(cards.count() == 5 and cards.filter(has_text="dropped-skill").count() == 1, "dropped skill appears")
    st = dlg.get_by_test_id("skill-status").inner_text()
    check("dropped-skill installed to Claude Code" in st and "notes.txt" in st and "ignored" in st, f"status line per file: {st!r}")
    check(pg.get_by_test_id("skill-drop-overlay").count() == 0, "overlay hidden after drop")

    # drop with cancel -> nothing installed
    pg.evaluate(DROP, [[["other.md", "# T\nSome text"]], "drop"])
    pg.wait_for_timeout(400)
    pg.get_by_role("dialog").filter(has_text="Install skills").last.get_by_role("button", name="Cancel").click()
    pg.wait_for_timeout(400)
    check(len(ipc(pg, "create_skill")) == 1, "cancel installs nothing")

    # install to both CLIs via New skill form
    grp.get_by_role("checkbox", name="Install to Codex").click()
    dlg.get_by_role("button", name="New skill").click()
    f = dlg.get_by_role("form", name="New skill")
    f.get_by_label("Name").fill("both-skill")
    f.get_by_label("Description").fill("On both")
    f.get_by_role("button", name="Create skill").click()
    pg.wait_for_timeout(600)
    c = ipc(pg, "create_skill")
    check({e["args"]["cli"] for e in c if e["args"]["name"] == "both-skill"} == {"claude", "codex"}, "created in every checked source")
    both = cards.filter(has_text="both-skill")
    check(both.count() == 1 and both.get_by_text("Claude Code", exact=True).count() == 1 and both.get_by_text("Codex", exact=True).count() == 1, "deduped into one card with both sources")

    # delete from all sources
    dlg.get_by_role("button", name="Delete both-skill").click()
    pg.wait_for_timeout(400)
    pg.get_by_role("dialog").filter(has_text="Delete skill").last.get_by_role("button", name="Delete", exact=True).click()
    pg.wait_for_timeout(600)
    d = [e for e in ipc(pg, "delete_skill") if e["args"]["name"] == "both-skill"]
    check({e["args"]["cli"] for e in d} == {"claude", "codex"} and cards.filter(has_text="both-skill").count() == 0, "delete removes from all sources")

    # MCP tab keeps selectors
    dlg.get_by_role("tab", name="MCP servers").click()
    pg.wait_for_timeout(400)
    check(dlg.get_by_role("radiogroup", name="CLI").count() == 1, "MCP tab still has CLI selector")
    check(dlg.get_by_label("Account").count() == 1, "MCP tab still has Account select")
    check(dlg.get_by_test_id("mcp-card").count() == 3, "MCP cards listed")
    pg.screenshot(path="/tmp/ui-skills-unified.png")

    check(not errors, f"no page errors {errors[:3]}")
    b.close()

print(f"RESULT {'FAIL' if fails else 'PASS'} {len(fails)}")
sys.exit(1 if fails else 0)

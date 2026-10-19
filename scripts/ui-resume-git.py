#!/usr/bin/env python3
"""Resume-all (relaunch with resume:true) + git tile tabs: stage/commit, branches, graph (mock IPC)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1432/"
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

    # ---------- Part A: Resume all relaunches stopped resumable consoles ----------
    # stop 2 running consoles (c1 claude with session, c3 claude without) via the mock
    for cid in ("c1", "c3"):
        pg.evaluate(f"window.__mock.running.delete('{cid}'); window.__mock.emit('console://exit', {{ id: '{cid}', code: 0 }})")
    pg.wait_for_timeout(700)
    # stopped + resumable now: c1 (claude, agentSession s1) and c2 (codex); c3 has no session, c4 is a shell

    before = len(pg.evaluate("window.__ipcLog"))
    pg.get_by_role("button", name="Resume all").click()
    pg.wait_for_timeout(1800)  # stagger 250ms between launches + spawn + attach

    log = pg.evaluate("window.__ipcLog")
    spawns = [e["args"]["args"] for e in log[before:] if e["cmd"] == "spawn_console"]
    resumed = sorted(a["id"] for a in spawns if a.get("resume") is True)
    check(resumed == ["c1", "c2"], f"spawn resume:true for c1+c2 (got {resumed})")
    check(all(a["id"] not in ("c3", "c4") for a in spawns), "claude-without-session + shell consoles untouched")
    check(pg.get_by_text("Resumed 2 consoles").count() == 1, "toast 'Resumed 2 consoles'")
    live = pg.evaluate("Array.from(window.__mock.running)")
    check("c1" in live and "c2" in live, f"both consoles running again in the mock ({live})")

    # old behaviour kept as a menu item (right-click like the New-console split button)
    pg.get_by_role("button", name="Resume all").click(button="right")
    menu = pg.get_by_role("menu")
    check(menu.get_by_role("menuitem", name="Nudge resting (continue)").count() == 1, "nudge resting menu item kept")
    pg.mouse.click(400, 200)  # dismiss
    pg.wait_for_timeout(300)

    # settings has the auto-resume toggle, off by default
    pg.get_by_role("button", name="Settings").click()
    pg.wait_for_timeout(400)
    row = pg.locator(".set-switch-row", has_text="Resume consoles on launch")
    check(row.count() == 1 and row.locator("input").is_checked() is False, "settings 'Resume consoles on launch' toggle (off)")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # ---------- Part B: git tile ----------
    pg.get_by_role("button", name="Add tile").click()
    pg.get_by_role("menu", name="Add tile").get_by_role("menuitem", name="Git").click()
    pg.wait_for_timeout(500)
    git = pg.locator(".tile[data-kind='git']").last

    # Changes tab (default): branch + checkboxes
    check(git.get_by_text("dev", exact=True).count() >= 1, "git tile shows branch")
    commit_btn = git.get_by_role("button", name="Commit", exact=True)
    check(not commit_btn.is_enabled(), "commit disabled with nothing staged / empty message")
    git.get_by_role("checkbox", name="Stage notes.md").click()
    pg.wait_for_timeout(400)
    log = pg.evaluate("window.__ipcLog")
    check(any(e["cmd"] == "git_stage" and e["args"].get("paths") == ["notes.md"] for e in log), "git_stage invoked for notes.md")
    check(git.get_by_role("checkbox", name="Stage notes.md").is_checked(), "notes.md checkbox shows staged")
    git.get_by_label("Commit message").fill("add notes")
    check(commit_btn.is_enabled(), "commit enabled with message + staged file")
    commit_btn.click()
    pg.wait_for_timeout(400)
    log = pg.evaluate("window.__ipcLog")
    commits = [e for e in log if e["cmd"] == "git_commit"]
    check(bool(commits) and commits[-1]["args"].get("message") == "add notes", "git_commit received the message")
    check(git.get_by_role("checkbox", name="Stage notes.md").count() == 0, "committed file left the changes list")

    # Graph tab: lane SVG + rows
    git.get_by_role("tab", name="Graph").click()
    pg.wait_for_timeout(400)
    rows = git.locator("ul[aria-label='Commits'] li")
    check(rows.count() >= 3, f"graph rows >= 3 (got {rows.count()})")
    check(git.locator("svg path").count() >= 3, "graph svg lane paths drawn")
    check(git.locator("svg circle").count() >= 3, "graph svg commit dots drawn")
    check(git.get_by_text("Merge branch 'graph-lanes'").count() == 1, "merge commit subject shown")

    # Branches tab: list of 2, checkout with confirm
    git.get_by_role("tab", name="Branches").click()
    pg.wait_for_timeout(400)
    lis = git.locator("ul[aria-label='Branches'] li")
    check(lis.count() == 2, f"branches tab lists 2 branches (got {lis.count()})")
    check(git.locator("ul[aria-label='Branches'] button[aria-current]").count() == 1, "current branch marked")
    git.locator("ul[aria-label='Branches'] button", has_text="main").click()
    pg.wait_for_timeout(500)
    log = pg.evaluate("window.__ipcLog")
    check(any(e["cmd"] == "git_checkout" and e["args"].get("branch") == "main" for e in log), "git_checkout main invoked")
    check(git.get_by_text("On main").count() == 1, "checkout note shown")

    # create a branch
    git.get_by_label("New branch name").fill("feature-x")
    git.get_by_role("button", name="Create", exact=True).click()
    pg.wait_for_timeout(400)
    log = pg.evaluate("window.__ipcLog")
    check(any(e["cmd"] == "git_create_branch" and e["args"].get("name") == "feature-x" for e in log), "git_create_branch invoked")
    check(git.locator("ul[aria-label='Branches'] li").count() == 3, "new branch appears in the list")

    pg.get_by_role("button", name="Fit view").click()
    pg.wait_for_timeout(600)
    pg.screenshot(path="/tmp/ab-resume-git.png")
    check(not errors, "no page errors " + "; ".join(errors[:2]))
    b.close()

print("RESULT", "FAIL" if fails else "PASS", len(fails))
sys.exit(1 if fails else 0)

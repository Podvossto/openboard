//! Git card: read repo state and run pull/push/commit through the user's own `git` CLI.

use std::path::Path;
use std::process::{Command, Output};

use serde::Serialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
    pub commits: Vec<GitCommit>,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// Two-letter XY code from porcelain v2 ("M.", ".M", "??" …)
    pub code: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub subject: String,
    pub when: String,
}

fn git(cwd: &Path, args: &[&str]) -> Result<Output> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::ProgramNotFound("git".into()),
        _ => Error::Io(e),
    })
}

fn ok(out: Output) -> Result<String> {
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let mut msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if msg.is_empty() {
            msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
        Err(Error::Pty(format!("git: {msg}")))
    }
}

/// Parse `git status --porcelain=v2 --branch`.
pub fn parse_status(s: &str) -> GitStatus {
    let mut st = GitStatus::default();
    for line in s.lines() {
        if let Some(h) = line.strip_prefix("# branch.head ") {
            st.branch = h.to_string();
        } else if let Some(u) = line.strip_prefix("# branch.upstream ") {
            st.upstream = Some(u.to_string());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for p in ab.split_whitespace() {
                if let Some(n) = p.strip_prefix('+') {
                    st.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = p.strip_prefix('-') {
                    st.behind = n.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ").or_else(|| line.strip_prefix("u ")) {
            // 1 XY sub mH mI mW hH hI path   (8 fields before path; u has 10)
            let n = if line.starts_with('u') { 9 } else { 7 };
            let mut it = rest.splitn(n + 1, ' ');
            let code = it.next().unwrap_or("").to_string();
            if let Some(path) = it.nth(n - 1) {
                st.changes.push(GitChange {
                    code,
                    path: path.to_string(),
                });
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // 2 XY sub mH mI mW hH hI Xscore path\torig
            let mut it = rest.splitn(9, ' ');
            let code = it.next().unwrap_or("").to_string();
            if let Some(paths) = it.nth(7) {
                let path = paths.split('\t').next().unwrap_or(paths);
                st.changes.push(GitChange {
                    code,
                    path: path.to_string(),
                });
            }
        } else if let Some(p) = line.strip_prefix("? ") {
            st.changes.push(GitChange {
                code: "??".into(),
                path: p.to_string(),
            });
        }
    }
    st
}

const SEP: char = '\u{1f}';

pub fn parse_log(s: &str) -> Vec<GitCommit> {
    s.lines()
        .filter_map(|l| {
            let mut p = l.split(SEP);
            Some(GitCommit {
                hash: p.next()?.to_string(),
                subject: p.next()?.to_string(),
                when: p.next().unwrap_or("").to_string(),
            })
        })
        .collect()
}

pub fn status(cwd: &Path) -> Result<GitStatus> {
    let mut st = parse_status(&ok(git(cwd, &["status", "--porcelain=v2", "--branch"])?)?);
    // empty repo has no log — not an error
    if let Ok(log) = ok(git(
        cwd,
        &["log", "-n", "8", "--pretty=format:%h\x1f%s\x1f%cr"],
    )?) {
        st.commits = parse_log(&log);
    }
    if let Ok(b) = ok(git(cwd, &["branch", "--format=%(refname:short)"])?) {
        st.branches = b.lines().map(str::to_string).collect();
    }
    Ok(st)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitAction {
    Pull,
    Push,
    /// `git add -A && git commit -m <message>`
    CommitAll,
}

pub fn run(cwd: &Path, action: GitAction, message: &str) -> Result<String> {
    match action {
        GitAction::Pull => ok(git(cwd, &["pull", "--ff-only"])?),
        GitAction::Push => ok(git(cwd, &["push"])?),
        GitAction::CommitAll => {
            let msg = message.trim();
            if msg.is_empty() {
                return Err(Error::Pty("commit message is empty".into()));
            }
            ok(git(cwd, &["add", "-A"])?)?;
            ok(git(cwd, &["commit", "-m", msg])?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let s = "# branch.oid abc\n# branch.head dev\n# branch.upstream origin/dev\n# branch.ab +2 -1\n\
1 .M N... 100644 100644 100644 aaa bbb src/app file.ts\n\
2 R. N... 100644 100644 100644 aaa bbb R100 new.rs\told.rs\n\
u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt\n\
? notes.md\n";
        let st = parse_status(s);
        assert_eq!(st.branch, "dev");
        assert_eq!(st.upstream.as_deref(), Some("origin/dev"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        let paths: Vec<_> = st
            .changes
            .iter()
            .map(|c| (c.code.as_str(), c.path.as_str()))
            .collect();
        assert_eq!(
            paths,
            vec![
                (".M", "src/app file.ts"),
                ("R.", "new.rs"),
                ("UU", "conflict.txt"),
                ("??", "notes.md")
            ]
        );
    }

    #[test]
    fn parses_log() {
        let c = parse_log("abc1234\x1ffix: thing\x1f2 hours ago\ndef5678\x1finit\x1f3 days ago");
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].subject, "fix: thing");
        assert_eq!(c[1].when, "3 days ago");
    }

    #[test]
    fn real_repo_status_and_commit() {
        let dir = std::env::temp_dir().join(format!("ab-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |a: &[&str]| ok(git(&dir, a).unwrap()).unwrap();
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.email", "t@t"]);
        g(&["config", "user.name", "t"]);
        g(&["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "hi").unwrap();
        let st = status(&dir).unwrap();
        assert_eq!(st.branch, "main");
        assert_eq!(st.changes.len(), 1);
        assert!(st.commits.is_empty());
        assert!(run(&dir, GitAction::CommitAll, "  ").is_err());
        run(&dir, GitAction::CommitAll, "first").unwrap();
        let st = status(&dir).unwrap();
        assert!(st.changes.is_empty());
        assert_eq!(st.commits[0].subject, "first");
        assert_eq!(st.branches, vec!["main".to_string()]);
        assert!(status(&std::env::temp_dir().join("definitely-not-a-repo-ab")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

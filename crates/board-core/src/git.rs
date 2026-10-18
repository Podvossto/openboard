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

// ---------- staging / committing ----------

/// `git add -- <paths>` (paths must be non-empty).
pub fn stage(cwd: &Path, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Err(Error::Pty("no paths to stage".into()));
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    ok(git(cwd, &args)?)?;
    Ok(())
}

/// `git reset -q -- <paths>` — takes paths out of the index without touching the work tree.
pub fn unstage(cwd: &Path, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Err(Error::Pty("no paths to unstage".into()));
    }
    let mut args: Vec<&str> = vec!["reset", "-q", "--"];
    args.extend(paths.iter().map(String::as_str));
    ok(git(cwd, &args)?)?;
    Ok(())
}

/// `git commit -m <message>` — commits what is staged, never adds anything.
pub fn commit(cwd: &Path, message: &str) -> Result<String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err(Error::Pty("commit message is empty".into()));
    }
    ok(git(cwd, &["commit", "-m", msg])?)
}

// ---------- branches ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

/// Parse `for-each-ref --format=%(refname:short)\x1f%(HEAD)`.
pub fn parse_branches(s: &str) -> Vec<GitBranch> {
    s.lines()
        .filter_map(|l| {
            let mut p = l.split(SEP);
            let name = p.next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(GitBranch {
                name,
                current: p.next().map(|h| h.trim() == "*").unwrap_or(false),
            })
        })
        .collect()
}

/// Local branches with the current one flagged.
pub fn branches(cwd: &Path) -> Result<Vec<GitBranch>> {
    let fmt = format!("--format=%(refname:short){SEP}%(HEAD)");
    let out = ok(git(
        cwd,
        &["for-each-ref", "--sort=refname", &fmt, "refs/heads/"],
    )?)?;
    Ok(parse_branches(&out))
}

/// Reject names git would refuse anyway (empty, flag-like, path traversal, whitespace).
fn valid_ref(name: &str) -> Result<&str> {
    let n = name.trim();
    if n.is_empty()
        || n.starts_with('-')
        || n.contains("..")
        || n.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(Error::Pty(format!("invalid branch name: {name:?}")));
    }
    Ok(n)
}

pub fn checkout(cwd: &Path, branch: &str) -> Result<()> {
    let b = valid_ref(branch)?;
    ok(git(cwd, &["checkout", b])?)?;
    Ok(())
}

/// Create a branch at HEAD without switching to it.
pub fn create_branch(cwd: &Path, name: &str) -> Result<()> {
    let b = valid_ref(name)?;
    ok(git(cwd, &["branch", b])?)?;
    Ok(())
}

// ---------- commit graph ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    /// Relative author date ("2 hours ago").
    pub rel_time: String,
    /// Decorations: "HEAD -> dev", "origin/main" …
    pub refs: Vec<String>,
}

/// One child→parent link between two rows of the graph, in lane coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneEdge {
    /// lane of the child (upper) commit
    pub from: usize,
    /// lane of the parent (lower) commit
    pub to: usize,
    pub from_row: usize,
    pub to_row: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraph {
    /// topo-ordered, newest first (same order `lanes` is indexed by)
    pub commits: Vec<GraphCommit>,
    /// lane index per commit
    pub lanes: Vec<usize>,
    pub edges: Vec<LaneEdge>,
    /// how many lanes the drawing must be wide for
    pub lane_count: usize,
}

/// Parse `git log --format=%H\x1f%P\x1f%an\x1f%ar\x1f%D\x1f%s`.
pub fn parse_graph(s: &str) -> Vec<GraphCommit> {
    s.lines()
        .filter_map(|l| {
            if l.trim().is_empty() {
                return None;
            }
            let mut p = l.split(SEP);
            Some(GraphCommit {
                hash: p.next()?.to_string(),
                parents: p
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                author: p.next().unwrap_or("").to_string(),
                rel_time: p.next().unwrap_or("").to_string(),
                refs: p
                    .next()
                    .unwrap_or("")
                    .split(',')
                    .map(|r| r.trim().to_string())
                    .filter(|r| !r.is_empty())
                    .collect(),
                subject: p.next().unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// `git log --all --topo-order -n <limit>` with parents/refs, ready for lane layout.
pub fn graph(cwd: &Path, limit: u32) -> Result<GitGraph> {
    let n = limit.to_string();
    let out = ok(git(
        cwd,
        &[
            "log",
            "--all",
            "--topo-order",
            "-n",
            &n,
            &format!("--format=%H{SEP}%P{SEP}%an{SEP}%ar{SEP}%D{SEP}%s"),
        ],
    )?)?;
    let commits = parse_graph(&out);
    let LaneLayout {
        lanes,
        edges,
        lane_count,
    } = lanes(&commits);
    Ok(GitGraph {
        commits,
        lanes,
        edges,
        lane_count,
    })
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LaneLayout {
    pub lanes: Vec<usize>,
    pub edges: Vec<LaneEdge>,
    pub lane_count: usize,
}

/// Assign each commit (topo order, newest first) a lane and link child→parent rows.
///
/// A lane "expects" the hash that should appear on it next: a commit's first parent
/// continues its lane unless another lane already expects that parent (a merge folded
/// in), in which case the lane ends and the connection is drawn as an edge instead.
pub fn lanes(commits: &[GraphCommit]) -> LaneLayout {
    fn free_lane(active: &mut Vec<Option<String>>) -> usize {
        active.iter().position(|e| e.is_none()).unwrap_or_else(|| {
            active.push(None);
            active.len() - 1
        })
    }
    let expects =
        |active: &[Option<String>], hash: &str| active.iter().any(|e| e.as_deref() == Some(hash));

    let mut active: Vec<Option<String>> = vec![];
    let mut out: Vec<usize> = Vec::with_capacity(commits.len());
    for c in commits {
        let hits: Vec<usize> = active
            .iter()
            .enumerate()
            .filter(|(_, e)| e.as_deref() == Some(c.hash.as_str()))
            .map(|(i, _)| i)
            .collect();
        let lane = match hits.first() {
            Some(&l) => {
                // a merge reaching the same commit from several lanes folds them together
                for &extra in &hits[1..] {
                    active[extra] = None;
                }
                l
            }
            None => free_lane(&mut active),
        };
        active[lane] = None; // consumed by this commit
        out.push(lane);
        if let Some(p0) = c.parents.first() {
            if !expects(&active, p0) {
                active[lane] = Some(p0.clone());
            }
        }
        for p in c.parents.iter().skip(1) {
            if !expects(&active, p) {
                let l = free_lane(&mut active);
                active[l] = Some(p.clone());
            }
        }
    }

    // second pass: one edge per (commit, parent) between their rows
    let mut index = std::collections::HashMap::with_capacity(commits.len());
    for (i, c) in commits.iter().enumerate() {
        index.insert(c.hash.as_str(), i);
    }
    let mut edges = Vec::new();
    for (i, c) in commits.iter().enumerate() {
        for p in &c.parents {
            if let Some(&j) = index.get(p.as_str()) {
                edges.push(LaneEdge {
                    from: out[i],
                    to: out[j],
                    from_row: i,
                    to_row: j,
                });
            }
        }
    }
    LaneLayout {
        lanes: out,
        edges,
        lane_count: active.len(),
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
    fn parses_log_graph_format() {
        let c = parse_graph(
            "abc\x1fdef ghi\x1fAl Ice\x1f2 hours ago\x1fHEAD -> dev, origin/dev\x1fmerge things\n\
             def\x1fabc\x1fAl Ice\x1f3 hours ago\x1f\x1fwork",
        );
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].parents, vec!["def".to_string(), "ghi".to_string()]);
        assert_eq!(
            c[0].refs,
            vec!["HEAD -> dev".to_string(), "origin/dev".to_string()]
        );
        assert!(c[1].refs.is_empty());
        assert_eq!(c[1].subject, "work");
        assert_eq!(c[1].rel_time, "3 hours ago");
        assert!(parse_graph("").is_empty());
    }

    #[test]
    fn parses_branches_with_head_marker() {
        let b = parse_branches(&format!("dev{SEP}*\nmain{SEP}"));
        assert_eq!(
            b,
            vec![
                GitBranch {
                    name: "dev".into(),
                    current: true
                },
                GitBranch {
                    name: "main".into(),
                    current: false
                }
            ]
        );
    }

    fn commit_of(hash: &str, parents: &[&str]) -> GraphCommit {
        GraphCommit {
            hash: hash.into(),
            parents: parents.iter().map(|s| s.to_string()).collect(),
            subject: hash.into(),
            author: "t".into(),
            rel_time: "now".into(),
            refs: vec![],
        }
    }

    #[test]
    fn lanes_linear_history() {
        // c → b → a (newest first)
        let cs = [
            commit_of("c", &["b"]),
            commit_of("b", &["a"]),
            commit_of("a", &[]),
        ];
        let l = lanes(&cs);
        assert_eq!(l.lanes, vec![0, 0, 0]);
        assert_eq!(l.lane_count, 1);
        assert_eq!(
            l.edges,
            vec![
                LaneEdge {
                    from: 0,
                    to: 0,
                    from_row: 0,
                    to_row: 1
                },
                LaneEdge {
                    from: 0,
                    to: 0,
                    from_row: 1,
                    to_row: 2
                },
            ]
        );
    }

    #[test]
    fn lanes_branch_and_merge() {
        // m2 merges b1 (branched off m1) back into the line that still has m1
        let cs = [
            commit_of("m2", &["b1", "m1"]),
            commit_of("b1", &["m1"]),
            commit_of("m1", &[]),
        ];
        let l = lanes(&cs);
        assert_eq!(l.lanes, vec![0, 0, 1]);
        assert_eq!(l.lane_count, 2);
        // m2→b1 straight down lane 0; both m2 and b1 curve over to m1 on lane 1
        assert_eq!(
            l.edges,
            vec![
                LaneEdge {
                    from: 0,
                    to: 0,
                    from_row: 0,
                    to_row: 1
                },
                LaneEdge {
                    from: 0,
                    to: 1,
                    from_row: 0,
                    to_row: 2
                },
                LaneEdge {
                    from: 0,
                    to: 1,
                    from_row: 1,
                    to_row: 2
                },
            ]
        );
    }

    #[test]
    fn lanes_two_independent_roots_reuse_a_freed_lane() {
        let cs = [commit_of("a", &[]), commit_of("b", &[])];
        let l = lanes(&cs);
        // a's lane ends with it, so b reuses the column instead of widening the graph
        assert_eq!(l.lanes, vec![0, 0]);
        assert!(l.edges.is_empty());
        assert_eq!(l.lane_count, 1);
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

    fn temp_repo(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ab-git-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |a: &[&str]| ok(git(&dir, a).unwrap()).unwrap();
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.email", "t@t"]);
        g(&["config", "user.name", "t"]);
        g(&["config", "commit.gpgsign", "false"]);
        dir
    }

    #[test]
    fn real_repo_stage_unstage_commit_staged_only() {
        let dir = temp_repo("stage");
        let code = |p: &str| {
            status(&dir)
                .unwrap()
                .changes
                .iter()
                .find(|c| c.path == p)
                .map(|c| c.code.clone())
                .unwrap_or_default()
        };
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        run(&dir, GitAction::CommitAll, "first").unwrap();
        std::fs::write(dir.join("a.txt"), "2").unwrap();
        std::fs::write(dir.join("n.txt"), "n").unwrap();

        // nothing staged → commit refuses; empty path lists are rejected
        let p = |s: &str| vec![s.to_string()];
        assert!(commit(&dir, "nope").is_err());
        assert!(stage(&dir, &[]).is_err());
        assert!(unstage(&dir, &[]).is_err());

        stage(&dir, &p("n.txt")).unwrap();
        assert_eq!(code("n.txt"), "A.");
        assert_eq!(code("a.txt"), ".M");
        unstage(&dir, &p("n.txt")).unwrap();
        assert_eq!(code("n.txt"), "??");

        // commit takes only what is staged: n.txt goes in, a.txt stays dirty
        stage(&dir, &p("n.txt")).unwrap();
        let out = commit(&dir, "second").unwrap();
        assert!(out.contains("second"));
        assert_eq!(code("n.txt"), "");
        assert_eq!(code("a.txt"), ".M");
        assert_eq!(status(&dir).unwrap().commits[0].subject, "second");
        assert!(commit(&dir, "   ").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_repo_branches_checkout_graph() {
        let dir = temp_repo("graph");
        let g = |a: &[&str]| ok(git(&dir, a).unwrap()).unwrap();
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-qm", "c1"]);
        create_branch(&dir, "dev").unwrap();
        checkout(&dir, "dev").unwrap();
        std::fs::write(dir.join("b.txt"), "2").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-qm", "c2"]);
        checkout(&dir, "main").unwrap();
        std::fs::write(dir.join("c.txt"), "3").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-qm", "c3"]);
        g(&["merge", "--no-edit", "dev"]);

        let bs = branches(&dir).unwrap();
        assert_eq!(
            bs,
            vec![
                GitBranch {
                    name: "dev".into(),
                    current: false
                },
                GitBranch {
                    name: "main".into(),
                    current: true
                },
            ]
        );

        let gr = graph(&dir, 60).unwrap();
        assert!(gr.commits.len() >= 4);
        assert_eq!(
            gr.commits[0].parents.len(),
            2,
            "merge commit has two parents"
        );
        assert_eq!(gr.lanes.len(), gr.commits.len());
        assert!(gr.lane_count >= 2, "branch + merge needs a second lane");
        assert!(!gr.edges.is_empty());
        assert!(gr.lanes.iter().all(|l| *l < gr.lane_count));
        assert!(gr
            .edges
            .iter()
            .all(|e| e.from < gr.lane_count && e.to < gr.lane_count));
        assert!(gr.commits[0].refs.iter().any(|r| r.contains("main")));

        checkout(&dir, "dev").unwrap();
        assert!(branches(&dir)
            .unwrap()
            .iter()
            .any(|b| b.name == "dev" && b.current));
        create_branch(&dir, "feature-x").unwrap();
        assert_eq!(branches(&dir).unwrap().len(), 3);
        assert!(checkout(&dir, "nope").is_err());
        assert!(create_branch(&dir, "..").is_err());
        assert!(create_branch(&dir, " --exec").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

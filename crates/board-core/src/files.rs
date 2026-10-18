//! Code studio: sandboxed file browsing / reading / atomic writing under a root folder.
//!
//! Every relative path is validated and resolved so it can never leave `root`
//! (no `..`, no absolute paths, no symlink escapes).

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::{Error, Result};

/// Reads larger than this are truncated.
pub const MAX_READ: u64 = 2 * 1024 * 1024;
/// Names never listed.
const HIDDEN: &[&str] = &[".git", "node_modules", "target", "dist"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    /// path relative to root, `/`-separated
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

fn denied(msg: &str) -> Error {
    Error::Io(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        msg.to_string(),
    ))
}

/// Lexically validate a relative path: only normal components allowed.
fn clean_rel(rel: &str) -> Result<PathBuf> {
    let mut out = PathBuf::new();
    for c in Path::new(&rel.replace('\\', "/")).components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return Err(denied("path escapes the project folder")),
        }
    }
    // a drive-style or rooted rel on Windows would have produced Prefix/RootDir above
    if rel.starts_with('/') || rel.starts_with('\\') || rel.contains(':') && cfg!(windows) {
        return Err(denied("absolute paths are not allowed"));
    }
    Ok(out)
}

/// Resolve `rel` under `root`, following symlinks, and require the result to stay inside root.
/// The final component may not exist yet (for writes): then its parent is checked instead.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let clean = clean_rel(rel)?;
    let root_c = root.canonicalize()?;
    let joined = root_c.join(&clean);
    let real = match joined.canonicalize() {
        Ok(p) => p,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let name = joined
                .file_name()
                .ok_or_else(|| denied("invalid path"))?
                .to_owned();
            let parent = joined.parent().ok_or_else(|| denied("invalid path"))?;
            parent.canonicalize()?.join(name)
        }
        Err(e) => return Err(e.into()),
    };
    if !real.starts_with(&root_c) {
        return Err(denied("path escapes the project folder"));
    }
    Ok(real)
}

/// Paths (relative, `/`-joined) that git ignores. Best effort: empty when not a repo / no git.
fn git_ignored(dir: &Path, names: &[String]) -> Vec<String> {
    if names.is_empty() {
        return vec![];
    }
    let spawn = Command::new("git")
        .args(["check-ignore", "-z", "--stdin"])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = spawn else { return vec![] };
    if let Some(mut stdin) = child.stdin.take() {
        let input = names.join("\0");
        // writer thread avoids a pipe deadlock on big directories
        std::thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let mut out = Vec::new();
    if let Some(mut so) = child.stdout.take() {
        let _ = so.read_to_end(&mut out);
    }
    let _ = child.wait();
    String::from_utf8_lossy(&out)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// List one directory: dirs first, then files, each alphabetical (case-insensitive).
pub fn list_dir(root: &Path, rel: &str) -> Result<Vec<FsEntry>> {
    let dir = resolve(root, rel)?;
    let root_c = root.canonicalize()?;
    let prefix = clean_rel(rel)?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if HIDDEN.contains(&name.as_str()) {
            continue;
        }
        // follow symlinks for type, but drop ones pointing outside the root
        let Ok(real) = e.path().canonicalize() else {
            continue;
        };
        if !real.starts_with(&root_c) {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&real) else {
            continue;
        };
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        entries.push(FsEntry {
            name,
            path,
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
        });
    }
    let ignored = git_ignored(
        &dir,
        &entries.iter().map(|e| e.name.clone()).collect::<Vec<_>>(),
    );
    entries.retain(|e| !ignored.contains(&e.name));
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Read a file (capped at 2 MB). `binary` when a NUL byte appears in the first chunk.
pub fn read_file(root: &Path, rel: &str) -> Result<FileContent> {
    let p = resolve(root, rel)?;
    if p.is_dir() {
        return Err(denied("is a directory"));
    }
    let mut f = std::fs::File::open(&p)?;
    let mut buf = Vec::new();
    (&mut f).take(MAX_READ + 1).read_to_end(&mut buf)?;
    let truncated = buf.len() as u64 > MAX_READ;
    if truncated {
        buf.truncate(MAX_READ as usize);
    }
    if buf.iter().take(8192).any(|b| *b == 0) {
        return Ok(FileContent {
            text: String::new(),
            truncated,
            binary: true,
        });
    }
    Ok(FileContent {
        text: String::from_utf8_lossy(&buf).into_owned(),
        truncated,
        binary: false,
    })
}

/// Atomic write: temp file in the same folder, then rename over the target.
pub fn write_file(root: &Path, rel: &str, text: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    if p.is_dir() {
        return Err(denied("is a directory"));
    }
    let dir = p.parent().ok_or_else(|| denied("invalid path"))?;
    let tmp = dir.join(format!(
        ".{}.agent-board.tmp",
        p.file_name().unwrap_or_default().to_string_lossy()
    ));
    let res = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, &p)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(res?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        std::fs::create_dir_all(r.join("src/deep")).unwrap();
        std::fs::create_dir_all(r.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(r.join(".git")).unwrap();
        std::fs::create_dir_all(r.join("target")).unwrap();
        std::fs::write(r.join("zeta.txt"), "z").unwrap();
        std::fs::write(r.join("Alpha.md"), "# a").unwrap();
        std::fs::write(r.join("src/main.ts"), "const a = 1;\n").unwrap();
        d
    }

    #[test]
    fn lists_dirs_first_and_hides_noise() {
        let d = tree();
        let l = list_dir(d.path(), "").unwrap();
        let names: Vec<_> = l.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["src", "Alpha.md", "zeta.txt"]);
        assert!(l[0].is_dir && !l[1].is_dir);
        let sub = list_dir(d.path(), "src").unwrap();
        assert_eq!(sub[0].name, "deep");
        assert_eq!(sub[1].path, "src/main.ts");
        assert_eq!(sub[1].size, 13);
    }

    #[test]
    fn respects_gitignore_when_repo() {
        let d = tree();
        let ok = Command::new("git")
            .args(["init", "-q"])
            .current_dir(d.path())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            return; // git not installed
        }
        std::fs::write(d.path().join(".gitignore"), "zeta.txt\n").unwrap();
        let names: Vec<_> = list_dir(d.path(), "")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert!(!names.contains(&"zeta.txt".to_string()));
        assert!(names.contains(&"Alpha.md".to_string()));
    }

    #[test]
    fn read_write_roundtrip_atomic() {
        let d = tree();
        let c = read_file(d.path(), "src/main.ts").unwrap();
        assert_eq!(c.text, "const a = 1;\n");
        assert!(!c.binary && !c.truncated);
        write_file(d.path(), "src/main.ts", "const b = 2;\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(d.path().join("src/main.ts")).unwrap(),
            "const b = 2;\n"
        );
        // no temp files left behind
        let left: Vec<_> = std::fs::read_dir(d.path().join("src"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(left.is_empty());
        // new file in existing dir
        write_file(d.path(), "src/new.ts", "x").unwrap();
        assert_eq!(read_file(d.path(), "src/new.ts").unwrap().text, "x");
    }

    #[test]
    fn binary_and_truncation() {
        let d = tree();
        std::fs::write(d.path().join("a.bin"), [1u8, 0, 2]).unwrap();
        assert!(read_file(d.path(), "a.bin").unwrap().binary);
        let big = vec![b'a'; MAX_READ as usize + 100];
        std::fs::write(d.path().join("big.txt"), big).unwrap();
        let c = read_file(d.path(), "big.txt").unwrap();
        assert!(c.truncated);
        assert_eq!(c.text.len() as u64, MAX_READ);
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        let d = tree();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        for bad in [
            "../secret.txt",
            "src/../../secret.txt",
            "..",
            "/etc/passwd",
            "\\windows\\system32",
        ] {
            assert!(read_file(d.path(), bad).is_err(), "read {bad}");
            assert!(write_file(d.path(), bad, "x").is_err(), "write {bad}");
            assert!(list_dir(d.path(), bad).is_err(), "list {bad}");
        }
        let abs = outside.path().join("secret.txt");
        assert!(read_file(d.path(), abs.to_str().unwrap()).is_err());
        assert!(write_file(d.path(), abs.to_str().unwrap(), "x").is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "s"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let d = tree();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), d.path().join("f.txt"))
            .unwrap();
        assert!(read_file(d.path(), "link/secret.txt").is_err());
        assert!(write_file(d.path(), "link/new.txt", "x").is_err());
        assert!(write_file(d.path(), "f.txt", "x").is_err());
        assert!(list_dir(d.path(), "link").is_err());
        // escaping symlinks are not listed
        let names: Vec<_> = list_dir(d.path(), "")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert!(!names.contains(&"link".to_string()));
        assert!(!names.contains(&"f.txt".to_string()));
    }
}

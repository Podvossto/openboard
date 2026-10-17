//! How to launch each agent CLI (fresh or resumed). Pure → unit-testable.

use std::path::{Path, PathBuf};

use crate::model::AgentKind;
use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub struct LaunchSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode<'a> {
    /// New conversation. For Claude, `session` is the id we pre-assign.
    Fresh {
        session: Option<&'a str>,
    },
    Resume {
        session: Option<&'a str>,
    },
}

/// `settings_file`: per-console Claude `--settings` file wiring hooks back to the app.
pub fn launch_spec(kind: &AgentKind, mode: Mode<'_>, settings_file: Option<&Path>) -> LaunchSpec {
    match kind {
        AgentKind::ClaudeCode => {
            let mut args = Vec::new();
            if let Some(f) = settings_file {
                args.push("--settings".into());
                args.push(f.display().to_string());
            }
            match mode {
                Mode::Fresh { session: Some(id) } => {
                    args.push("--session-id".into());
                    args.push(id.into());
                }
                Mode::Resume { session: Some(id) } => {
                    args.push("--resume".into());
                    args.push(id.into());
                }
                Mode::Resume { session: None } => args.push("--continue".into()),
                Mode::Fresh { session: None } => {}
            }
            LaunchSpec {
                program: "claude".into(),
                args,
            }
        }
        AgentKind::Codex => {
            let args = match mode {
                Mode::Resume { session: Some(id) } => vec!["resume".into(), id.into()],
                Mode::Resume { session: None } => vec!["resume".into(), "--last".into()],
                Mode::Fresh { .. } => vec![],
            };
            LaunchSpec {
                program: "codex".into(),
                args,
            }
        }
        AgentKind::Custom { program, args } => LaunchSpec {
            program: program.clone(),
            args: args.clone(),
        },
    }
}

/// Resolve a program on PATH (handles `.exe`/`.cmd` shims on Windows, e.g. npm installs).
pub fn resolve(program: &str) -> Result<PathBuf> {
    which::which(program).map_err(|_| Error::ProgramNotFound(program.into()))
}

/// Windows can't `CreateProcess` a batch file (npm installs `claude.cmd`, `codex.cmd`):
/// run it through `cmd.exe /d /c`. No-op for real executables and on other OSes.
pub fn wrap_batch(program: PathBuf, args: Vec<String>, comspec: &str) -> (PathBuf, Vec<String>) {
    let is_batch = program
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if !is_batch {
        return (program, args);
    }
    let mut wrapped = vec![
        "/d".to_string(),
        "/c".to_string(),
        program.display().to_string(),
    ];
    wrapped.extend(args);
    (PathBuf::from(comspec), wrapped)
}

/// Default interactive shell for "Custom" consoles.
pub fn default_shell() -> String {
    if cfg!(windows) {
        if which::which("pwsh").is_ok() {
            "pwsh".into()
        } else {
            "powershell".into()
        }
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_fresh_pins_session_and_settings() {
        let s = launch_spec(
            &AgentKind::ClaudeCode,
            Mode::Fresh {
                session: Some("abc"),
            },
            Some(Path::new("/x/s.json")),
        );
        assert_eq!(s.program, "claude");
        assert_eq!(s.args, ["--settings", "/x/s.json", "--session-id", "abc"]);
    }

    #[test]
    fn claude_resume() {
        let s = launch_spec(
            &AgentKind::ClaudeCode,
            Mode::Resume {
                session: Some("abc"),
            },
            None,
        );
        assert_eq!(s.args, ["--resume", "abc"]);
        let s = launch_spec(&AgentKind::ClaudeCode, Mode::Resume { session: None }, None);
        assert_eq!(s.args, ["--continue"]);
    }

    #[test]
    fn codex_resume_last() {
        let s = launch_spec(&AgentKind::Codex, Mode::Resume { session: None }, None);
        assert_eq!(s.args, ["resume", "--last"]);
    }

    #[test]
    fn custom_passthrough() {
        let k = AgentKind::Custom {
            program: "aider".into(),
            args: vec!["--yes".into()],
        };
        let s = launch_spec(&k, Mode::Resume { session: None }, None);
        assert_eq!(
            s,
            LaunchSpec {
                program: "aider".into(),
                args: vec!["--yes".into()]
            }
        );
    }

    #[test]
    fn wraps_npm_batch_shims_only() {
        let (p, a) = wrap_batch(
            PathBuf::from(r"C:\npm\claude.CMD"),
            vec!["--resume".into(), "x".into()],
            r"C:\Windows\System32\cmd.exe",
        );
        assert_eq!(p, PathBuf::from(r"C:\Windows\System32\cmd.exe"));
        assert_eq!(a, ["/d", "/c", r"C:\npm\claude.CMD", "--resume", "x"]);
        let (p, a) = wrap_batch(PathBuf::from("/usr/bin/claude"), vec!["-c".into()], "cmd");
        assert_eq!(p, PathBuf::from("/usr/bin/claude"));
        assert_eq!(a, ["-c"]);
    }

    #[test]
    fn resolve_missing_program() {
        assert!(matches!(
            resolve("definitely-not-a-real-cli-xyz"),
            Err(Error::ProgramNotFound(_))
        ));
    }
}

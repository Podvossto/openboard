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

/// Command that runs the CLI's own interactive login flow (opened in a console).
pub fn login_spec(kind: &AgentKind) -> Option<LaunchSpec> {
    match kind {
        AgentKind::ClaudeCode => Some(LaunchSpec {
            program: "claude".into(),
            args: vec!["/login".into()],
        }),
        AgentKind::Codex => Some(LaunchSpec {
            program: "codex".into(),
            args: vec!["login".into()],
        }),
        AgentKind::Custom { .. } => None,
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    pub installed: bool,
    pub logged_in: bool,
    /// Human-readable detail (email / plan) — never a secret.
    pub detail: Option<String>,
}

/// Best-effort, offline login detection from the CLI's own config files. Read-only.
pub fn auth_info(kind: &AgentKind, home: &Path) -> AuthInfo {
    let installed = match kind {
        AgentKind::ClaudeCode => resolve("claude").is_ok(),
        AgentKind::Codex => resolve("codex").is_ok(),
        AgentKind::Custom { program, .. } => resolve(program).is_ok(),
    };
    let (logged_in, detail) = match kind {
        AgentKind::ClaudeCode => claude_auth(home),
        AgentKind::Codex => codex_auth(home),
        AgentKind::Custom { .. } => (installed, None),
    };
    AuthInfo {
        installed,
        logged_in,
        detail,
    }
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

fn claude_auth(home: &Path) -> (bool, Option<String>) {
    let creds = read_json(&home.join(".claude").join(".credentials.json"));
    let oauth = creds.as_ref().and_then(|c| c.get("claudeAiOauth"));
    let token = oauth
        .and_then(|o| o.get("accessToken"))
        .and_then(|t| t.as_str())
        .is_some();
    let plan = oauth
        .and_then(|o| o.get("subscriptionType"))
        .and_then(|t| t.as_str())
        .map(str::to_owned);
    let email = read_json(&home.join(".claude.json")).and_then(|c| {
        c.pointer("/oauthAccount/emailAddress")
            .and_then(|e| e.as_str())
            .map(str::to_owned)
    });
    // On Windows Claude Code may keep credentials elsewhere; an account entry still means login.
    let logged_in = token || email.is_some();
    let detail = match (email, plan) {
        (Some(e), Some(p)) => Some(format!("{e} · {p}")),
        (Some(e), None) => Some(e),
        (None, Some(p)) => Some(p),
        _ => None,
    };
    (logged_in, detail)
}

fn codex_auth(home: &Path) -> (bool, Option<String>) {
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    match read_json(&codex_home.join("auth.json")) {
        Some(a) => {
            let mode = if a.get("tokens").is_some_and(|t| !t.is_null()) {
                "ChatGPT account"
            } else if a.get("OPENAI_API_KEY").is_some_and(|k| !k.is_null()) {
                "API key"
            } else {
                return (false, None);
            };
            (true, Some(mode.into()))
        }
        None => (false, None),
    }
}

/// Prompt asking an agent to summarise a console transcript for handoff to another agent.
pub fn handoff_prompt(from_title: &str, to_title: &str, transcript: &str) -> String {
    format!(
        "You are preparing a handoff brief. Below is the recent terminal transcript of the \
agent console \"{from_title}\". Write a concise brief (max ~250 words) for the agent \
\"{to_title}\" who will continue the work: goal, what is done, current state, open \
problems, and the exact next steps. Plain text, no preamble.\n\n---- transcript ----\n{transcript}"
    )
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
    fn detects_logins_from_config_files() {
        let d = tempfile::tempdir().unwrap();
        let h = d.path();
        assert!(!claude_auth(h).0);
        std::fs::create_dir_all(h.join(".claude")).unwrap();
        std::fs::write(
            h.join(".claude/.credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"x","subscriptionType":"pro"}}"#,
        )
        .unwrap();
        std::fs::write(
            h.join(".claude.json"),
            r#"{"oauthAccount":{"emailAddress":"a@b.c"}}"#,
        )
        .unwrap();
        assert_eq!(claude_auth(h), (true, Some("a@b.c · pro".into())));

        std::env::remove_var("CODEX_HOME");
        assert!(!codex_auth(h).0);
        std::fs::create_dir_all(h.join(".codex")).unwrap();
        std::fs::write(
            h.join(".codex/auth.json"),
            r#"{"OPENAI_API_KEY":null,"tokens":{"a":1}}"#,
        )
        .unwrap();
        assert_eq!(codex_auth(h), (true, Some("ChatGPT account".into())));
    }

    #[test]
    fn login_specs() {
        assert_eq!(login_spec(&AgentKind::ClaudeCode).unwrap().args, ["/login"]);
        assert_eq!(login_spec(&AgentKind::Codex).unwrap().args, ["login"]);
        assert!(login_spec(&AgentKind::Custom {
            program: "x".into(),
            args: vec![]
        })
        .is_none());
    }

    #[test]
    fn handoff_prompt_mentions_both() {
        let p = handoff_prompt("api", "web", "did X");
        assert!(p.contains("\"api\"") && p.contains("\"web\"") && p.ends_with("did X"));
    }

    #[test]
    fn resolve_missing_program() {
        assert!(matches!(
            resolve("definitely-not-a-real-cli-xyz"),
            Err(Error::ProgramNotFound(_))
        ));
    }
}

//! Persisted workspace model. Bump [`WORKSPACE_VERSION`] and add a migration in
//! `persist::migrate` whenever the on-disk shape changes.

use serde::{Deserialize, Serialize};

pub const WORKSPACE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub viewport: Viewport,
    #[serde(default)]
    pub consoles: Vec<ConsoleNode>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            version: WORKSPACE_VERSION,
            name: "Main".into(),
            viewport: Viewport::default(),
            consoles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleNode {
    /// Stable id (uuid v4) — also used as the hook routing key.
    pub id: String,
    pub title: String,
    pub agent: AgentKind,
    /// Working directory the CLI starts in.
    pub cwd: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Agent-side session id used for resume (Claude: the `--session-id` we assigned).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentKind {
    ClaudeCode,
    Codex,
    /// Any other program (shell, aider, gemini ...). Status is heuristic only.
    Custom {
        program: String,
        #[serde(default)]
        args: Vec<String>,
    },
}

impl AgentKind {
    pub fn label(&self) -> &str {
        match self {
            AgentKind::ClaudeCode => "Claude Code",
            AgentKind::Codex => "Codex",
            AgentKind::Custom { program, .. } => program,
        }
    }

    pub fn supports_hooks(&self) -> bool {
        matches!(self, AgentKind::ClaudeCode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_kind_json_shape_is_stable() {
        let j = serde_json::to_string(&AgentKind::ClaudeCode).unwrap();
        assert_eq!(j, r#"{"kind":"claudeCode"}"#);
        let c: AgentKind = serde_json::from_str(r#"{"kind":"custom","program":"pwsh"}"#).unwrap();
        assert_eq!(
            c,
            AgentKind::Custom {
                program: "pwsh".into(),
                args: vec![]
            }
        );
    }
}

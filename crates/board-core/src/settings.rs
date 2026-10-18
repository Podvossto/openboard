//! App settings (separate from workspaces): defaults for new consoles + UI prefs.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::model::AgentKind;
use crate::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Working directory for new consoles. Empty → user's home.
    pub default_cwd: String,
    /// Agent created by the primary "+" button.
    pub default_agent: AgentKind,
    /// Shell for "+ Shell" consoles. Empty → auto (pwsh > powershell / $SHELL).
    pub shell: String,
    /// Extra args per agent CLI (e.g. `--model opus`).
    pub claude_args: Vec<String>,
    pub codex_args: Vec<String>,
    /// OS notification when a console needs you and the window is unfocused.
    pub notify_needs_you: bool,
    /// Blink the console border while it needs you.
    pub blink_needs_you: bool,
    pub font_size: u16,
    /// Show Claude plan usage in the top bar (reads Claude Code's own token, read-only).
    pub show_usage: bool,
    /// On app start, relaunch every stopped console that has a resumable session.
    #[serde(default)]
    pub auto_resume: bool,
    /// Extra accounts / providers (keys are in the OS credential store, never here).
    pub profiles: Vec<crate::profiles::Profile>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_cwd: String::new(),
            default_agent: AgentKind::ClaudeCode,
            shell: String::new(),
            claude_args: vec![],
            codex_args: vec![],
            notify_needs_you: true,
            blink_needs_you: true,
            font_size: 13,
            show_usage: true,
            auto_resume: false,
            profiles: vec![],
        }
    }
}

impl Settings {
    pub fn resolved_cwd(&self) -> PathBuf {
        let p = PathBuf::from(self.default_cwd.trim());
        if !self.default_cwd.trim().is_empty() && p.is_dir() {
            return p;
        }
        home_dir().unwrap_or_else(std::env::temp_dir)
    }
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir.join("settings.json"),
        })
    }

    /// Missing or unreadable file → defaults (settings are never worth crashing over).
    pub fn load(&self) -> Settings {
        fs::read(&self.path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, s: &Settings) -> Result<()> {
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_partial_files_get_defaults() {
        let d = tempfile::tempdir().unwrap();
        let st = SettingsStore::new(d.path()).unwrap();
        assert_eq!(st.load(), Settings::default());
        let s = Settings {
            default_cwd: "C:/dev".into(),
            font_size: 15,
            ..Default::default()
        };
        st.save(&s).unwrap();
        assert_eq!(st.load(), s);
        fs::write(d.path().join("settings.json"), br#"{"fontSize": 11}"#).unwrap();
        let l = st.load();
        assert_eq!(l.font_size, 11);
        assert!(l.blink_needs_you);
        assert!(!l.auto_resume); // serde default: off unless the user turns it on
        fs::write(d.path().join("settings.json"), br#"{"autoResume": true}"#).unwrap();
        assert!(st.load().auto_resume);
        fs::write(d.path().join("settings.json"), b"garbage").unwrap();
        assert_eq!(st.load(), Settings::default());
    }

    #[test]
    fn resolved_cwd_falls_back_when_missing() {
        let s = Settings {
            default_cwd: "/definitely/not/here".into(),
            ..Default::default()
        };
        assert!(s.resolved_cwd().is_dir());
        let d = tempfile::tempdir().unwrap();
        let s = Settings {
            default_cwd: d.path().display().to_string(),
            ..Default::default()
        };
        assert_eq!(s.resolved_cwd(), d.path());
    }
}

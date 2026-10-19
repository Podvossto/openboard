//! Catalog of terminal coding agents beyond Claude Code / Codex. Every entry runs as a
//! plain `Custom` console (real PTY, the CLI's own login); status is heuristic only.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// Stable key, also used for the icon tint.
    pub id: &'static str,
    pub name: &'static str,
    /// Executable looked up on PATH.
    pub program: &'static str,
    /// How to install it (shown when missing).
    pub install: &'static str,
}

const fn e(
    id: &'static str,
    name: &'static str,
    program: &'static str,
    install: &'static str,
) -> CatalogEntry {
    CatalogEntry {
        id,
        name,
        program,
        install,
    }
}

pub const CATALOG: &[CatalogEntry] = &[
    e(
        "gemini",
        "Gemini CLI",
        "gemini",
        "npm i -g @google/gemini-cli",
    ),
    e("opencode", "OpenCode", "opencode", "npm i -g opencode-ai"),
    e(
        "aider",
        "Aider",
        "aider",
        "pip install aider-install && aider-install",
    ),
    e("qwen", "Qwen Code", "qwen", "npm i -g @qwen-code/qwen-code"),
    e(
        "copilot",
        "Copilot CLI",
        "copilot",
        "npm i -g @github/copilot",
    ),
    e("cursor", "Cursor CLI", "cursor-agent", "see cursor.com/cli"),
    e("amp", "Amp", "amp", "npm i -g @sourcegraph/amp"),
    e("goose", "Goose", "goose", "see block.github.io/goose"),
    e("crush", "Crush", "crush", "npm i -g @charmland/crush"),
    e("grok", "Grok CLI", "grok", "npm i -g @vibe-kit/grok-cli"),
    e("kimi", "Kimi CLI", "kimi", "uv tool install kimi-cli"),
    e("droid", "Droid", "droid", "see factory.ai"),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    #[serde(flatten)]
    pub entry: CatalogEntry,
    pub installed: bool,
    /// Console launch for the install hint (`None` → `install_url`).
    pub install_program: Option<String>,
    pub install_args: Vec<String>,
    pub install_url: Option<String>,
}

/// Catalog with an `installed` flag decided by `is_installed(program)`.
pub fn detect(is_installed: impl Fn(&str) -> bool) -> Vec<CatalogStatus> {
    CATALOG
        .iter()
        .map(|e| {
            let cmd = install_command(e.id);
            CatalogStatus {
                entry: e.clone(),
                installed: is_installed(e.program),
                install_program: cmd.as_ref().map(|c| c.0.clone()),
                install_args: cmd.map(|c| c.1).unwrap_or_default(),
                install_url: install_url(e.id),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_programs_are_unique() {
        let mut ids: Vec<_> = CATALOG.iter().map(|e| e.id).collect();
        let mut progs: Vec<_> = CATALOG.iter().map(|e| e.program).collect();
        ids.sort();
        progs.sort();
        ids.dedup();
        progs.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        assert_eq!(progs.len(), CATALOG.len());
    }

    #[test]
    fn detect_uses_predicate_and_flattens() {
        let d = detect(|p| p == "gemini");
        assert!(d.iter().find(|s| s.entry.id == "gemini").unwrap().installed);
        assert!(!d.iter().find(|s| s.entry.id == "aider").unwrap().installed);
        let j = serde_json::to_value(&d[0]).unwrap();
        assert_eq!(j["id"], "gemini");
        assert_eq!(j["installed"], true);
    }
}

/// How to run an entry's `install` hint in a console: (program, args). `None` when the hint
/// is a URL ("see …") — the UI opens the docs instead. Windows runs it via `cmd /C` so
/// npm/pip shims resolve; elsewhere via `sh -c`.
pub fn install_command(id: &str) -> Option<(String, Vec<String>)> {
    let e = CATALOG.iter().find(|e| e.id == id)?;
    if e.install.starts_with("see ") {
        return None;
    }
    Some(if cfg!(windows) {
        ("cmd".into(), vec!["/C".into(), e.install.into()])
    } else {
        ("sh".into(), vec!["-c".into(), e.install.into()])
    })
}

/// Docs URL for a "see …" hint (prefixed with https://).
pub fn install_url(id: &str) -> Option<String> {
    let e = CATALOG.iter().find(|e| e.id == id)?;
    e.install
        .strip_prefix("see ")
        .map(|u| format!("https://{}", u.trim()))
}

#[cfg(test)]
mod install_tests {
    use super::*;

    #[test]
    fn install_commands_and_urls() {
        let (prog, args) = install_command("gemini").unwrap();
        assert!(prog == "cmd" || prog == "sh");
        assert_eq!(args.last().unwrap(), "npm i -g @google/gemini-cli");
        assert!(install_command("cursor").is_none());
        assert_eq!(
            install_url("cursor").as_deref(),
            Some("https://cursor.com/cli")
        );
        assert!(install_url("gemini").is_none());
        assert!(install_command("nope").is_none());
        // every entry has either a runnable command or a docs URL
        for e in CATALOG {
            assert!(
                install_command(e.id).is_some() ^ install_url(e.id).is_some(),
                "{}",
                e.id
            );
        }
    }
}

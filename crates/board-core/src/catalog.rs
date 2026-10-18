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
}

/// Catalog with an `installed` flag decided by `is_installed(program)`.
pub fn detect(is_installed: impl Fn(&str) -> bool) -> Vec<CatalogStatus> {
    CATALOG
        .iter()
        .map(|e| CatalogStatus {
            entry: e.clone(),
            installed: is_installed(e.program),
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

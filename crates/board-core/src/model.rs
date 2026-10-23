//! Persisted board model. Bump [`WORKSPACE_VERSION`] and add a step in
//! `persist::migrate` whenever the on-disk shape changes.
//!
//! v1: one workspace `{version,name,viewport,consoles}`
//! v2: a board of many workspaces (tabs) with groups, memory and presets.

use serde::{Deserialize, Serialize};

pub const WORKSPACE_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub version: u32,
    pub active: String,
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub presets: Vec<Preset>,
}

impl Default for Board {
    fn default() -> Self {
        let ws = Workspace::new("ws-main", "Main");
        Self {
            version: WORKSPACE_VERSION,
            active: ws.id.clone(),
            workspaces: vec![ws],
            presets: default_presets(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub viewport: Viewport,
    #[serde(default)]
    pub consoles: Vec<ConsoleNode>,
    #[serde(default)]
    pub groups: Vec<Group>,
    /// Large labelled canvas frames; members carry `section` and keep absolute coordinates.
    #[serde(default)]
    pub sections: Vec<Section>,
    /// Shared notes for this workspace.
    #[serde(default)]
    pub memory: String,
    /// Give `memory` to every Claude console started in this workspace (system prompt).
    #[serde(default)]
    pub memory_auto: bool,
    /// Non-console tiles: notes, checklists, kanban, web previews, git cards.
    #[serde(default)]
    pub tiles: Vec<Tile>,
    /// Freehand ink strokes in board coordinates (frontend-owned shape).
    #[serde(default)]
    pub ink: Vec<serde_json::Value>,
}

impl Workspace {
    pub fn new(id: &str, name: &str) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            viewport: Viewport::default(),
            consoles: vec![],
            groups: vec![],
            sections: vec![],
            memory: String::new(),
            memory_auto: false,
            tiles: vec![],
            ink: vec![],
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
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Section this group frame belongs to (absolute coordinates).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

/// Large labelled canvas frame that can hold consoles, groups and tiles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A board tile that is not a terminal. `data` is owned by the frontend per `kind`
/// (note: {text}, checklist: {items}, kanban: {columns}, web: {url,…}, git: {cwd},
/// calendar: {events, view, cursor}).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub id: String,
    pub kind: TileKind,
    #[serde(default)]
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    #[serde(default)]
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TileKind {
    Note,
    Checklist,
    Kanban,
    Web,
    Git,
    Code,
    Calendar,
    Image,
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
    /// Position is relative to the group when `group` is set.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// Section this (ungrouped) console belongs to; x/y are absolute then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// Agent-side session id used for resume (Claude: the `--session-id` we assigned).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session: Option<String>,
    /// Profile id (account / provider). None → the CLI's default login.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// Orchestrator lead (Claude only): started with the openboard MCP tools.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub lead: bool,
    /// Per-console model override (`--model`). None → the CLI's default model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Automation loop config (frontend-owned shape, see src/features/loops).
    #[serde(rename = "loop", default, skip_serializing_if = "Option::is_none")]
    pub loop_cfg: Option<serde_json::Value>,
    /// Tile ids linked to this console (agent ↔ tile): it gets tools for them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    /// Agent preset this console was made from (role prompt / extra MCP come from it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
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

/// A saved team layout: "spawn these agents in a group".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub members: Vec<PresetMember>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetMember {
    pub title: String,
    pub agent: AgentKind,
}

pub fn default_presets() -> Vec<Preset> {
    let m = |t: &str, a: AgentKind| PresetMember {
        title: t.into(),
        agent: a,
    };
    vec![
        Preset {
            id: "preset-pair".into(),
            name: "Pair (Claude + Codex)".into(),
            members: vec![
                m("builder", AgentKind::ClaudeCode),
                m("reviewer", AgentKind::Codex),
            ],
        },
        Preset {
            id: "preset-squad".into(),
            name: "Squad (3 Claude + shell)".into(),
            members: vec![
                m("frontend", AgentKind::ClaudeCode),
                m("backend", AgentKind::ClaudeCode),
                m("tests", AgentKind::ClaudeCode),
                m(
                    "shell",
                    AgentKind::Custom {
                        program: String::new(),
                        args: vec![],
                    },
                ),
            ],
        },
    ]
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

    #[test]
    fn workspace_without_tiles_still_loads() {
        let w: Workspace = serde_json::from_str(r#"{"id":"a","name":"A"}"#).unwrap();
        assert!(w.tiles.is_empty());
        let t: Tile = serde_json::from_str(
            r#"{"id":"t","kind":"kanban","x":1,"y":2,"width":3,"height":4,"data":{"columns":[]}}"#,
        )
        .unwrap();
        assert_eq!(t.kind, TileKind::Kanban);
        assert_eq!(t.data["columns"], serde_json::json!([]));
    }

    #[test]
    fn calendar_tile_json_roundtrip() {
        let t: Tile = serde_json::from_str(
            r##"{"id":"cal","kind":"calendar","title":"Calendar","x":1,"y":2,"width":560,"height":460,
                "data":{"events":[{"id":"e1","date":"2026-10-18","time":"09:00","title":"Standup","color":"#8ea2ff"}],
                        "view":"month","cursor":"2026-10-18"}}"##,
        )
        .unwrap();
        assert_eq!(t.kind, TileKind::Calendar);
        assert_eq!(t.data["events"][0]["title"], serde_json::json!("Standup"));
        assert_eq!(
            serde_json::to_string(&TileKind::Calendar).unwrap(),
            r#""calendar""#
        );
        // web tile keeps its device fields (free JSON) across a round-trip
        let w: Tile = serde_json::from_str(
            r#"{"id":"w","kind":"web","x":0,"y":0,"width":720,"height":480,
                "data":{"url":"http://localhost:5173","preset":"iphone-15-pro","w":393,"h":852,"rotated":false,"zoom":"fit"}}"#,
        )
        .unwrap();
        assert_eq!(w.data["preset"], serde_json::json!("iphone-15-pro"));
        assert_eq!(w.data["zoom"], serde_json::json!("fit"));
    }

    #[test]
    fn sections_roundtrip_and_old_boards_load() {
        let old: Workspace = serde_json::from_str(r#"{"id":"a","name":"A"}"#).unwrap();
        assert!(old.sections.is_empty());
        let w: Workspace = serde_json::from_str(
            r##"{"id":"a","name":"A",
                "sections":[{"id":"s1","name":"Section 1","color":"#7c9cff","x":1,"y":2,"width":900,"height":600}],
                "groups":[{"id":"g","name":"G","color":"#fff","x":0,"y":0,"width":9,"height":9,"section":"s1"}],
                "tiles":[{"id":"t","kind":"note","x":0,"y":0,"width":1,"height":1,"section":"s1","data":{}}]}"##,
        )
        .unwrap();
        assert_eq!(w.sections[0].width, 900.0);
        assert_eq!(w.groups[0].section.as_deref(), Some("s1"));
        assert_eq!(w.tiles[0].section.as_deref(), Some("s1"));
        let back: Workspace = serde_json::from_str(&serde_json::to_string(&w).unwrap()).unwrap();
        assert_eq!(back, w);
        // members without a section don't serialise the key
        assert!(!serde_json::to_string(&old)
            .unwrap()
            .contains("\"section\":"));
    }

    #[test]
    fn default_board_is_consistent() {
        let b = Board::default();
        assert!(b.workspaces.iter().any(|w| w.id == b.active));
        assert!(!b.presets.is_empty());
    }
}

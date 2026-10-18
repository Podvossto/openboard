//! Crash-safe board persistence: write temp → fsync → rename, keep N rotating backups,
//! fall back to the newest readable backup if the main file is corrupt, migrate old versions.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::model::{default_presets, Board, WORKSPACE_VERSION};
use crate::{Error, Result};

const FILE: &str = "workspace.json";
const BACKUPS: usize = 5;

pub struct Store {
    dir: PathBuf,
}

#[derive(Debug, PartialEq)]
pub enum LoadOutcome {
    Fresh,
    Loaded,
    RecoveredFromBackup(usize),
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    fn backup(&self, n: usize) -> PathBuf {
        self.dir.join(format!("{FILE}.bak{n}"))
    }

    pub fn load(&self) -> Result<(Board, LoadOutcome)> {
        let main = self.path();
        if !main.exists() {
            return Ok((Board::default(), LoadOutcome::Fresh));
        }
        match read(&main) {
            Ok(b) => Ok((b, LoadOutcome::Loaded)),
            Err(e @ Error::UnsupportedVersion { .. }) => Err(e),
            Err(e) => {
                tracing::warn!("board unreadable ({e}); trying backups");
                for n in 1..=BACKUPS {
                    if let Ok(b) = read(&self.backup(n)) {
                        return Ok((b, LoadOutcome::RecoveredFromBackup(n)));
                    }
                }
                Err(e)
            }
        }
    }

    pub fn save(&self, board: &Board) -> Result<()> {
        let main = self.path();
        let tmp = self.dir.join(format!("{FILE}.tmp"));
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&serde_json::to_vec_pretty(board)?)?;
            f.sync_all()?;
        }
        if main.exists() {
            for n in (1..BACKUPS).rev() {
                let from = self.backup(n);
                if from.exists() {
                    fs::rename(&from, self.backup(n + 1))?;
                }
            }
            fs::copy(&main, self.backup(1))?;
        }
        fs::rename(&tmp, &main)?;
        Ok(())
    }
}

fn read(p: &Path) -> Result<Board> {
    let raw: Value = serde_json::from_slice(&fs::read(p)?)?;
    migrate(raw)
}

/// Upgrade any older on-disk version to the current [`Board`].
pub fn migrate(mut raw: Value) -> Result<Board> {
    let mut found = raw.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    if found > WORKSPACE_VERSION {
        return Err(Error::UnsupportedVersion {
            found,
            max: WORKSPACE_VERSION,
        });
    }
    if found <= 1 {
        // v1 was a single workspace → wrap it as the only tab.
        let mut ws = raw;
        if let Some(o) = ws.as_object_mut() {
            o.remove("version");
            o.insert("id".into(), json!("ws-main"));
            o.entry("name").or_insert(json!("Main"));
        }
        raw = json!({
            "version": 2,
            "active": "ws-main",
            "workspaces": [ws],
            "presets": serde_json::to_value(default_presets())?,
        });
        found = 2;
    }
    debug_assert_eq!(found, WORKSPACE_VERSION);
    let mut b: Board = serde_json::from_value(raw)?;
    b.version = WORKSPACE_VERSION;
    if b.workspaces.is_empty() {
        b = Board::default();
    }
    if !b.workspaces.iter().any(|w| w.id == b.active) {
        b.active = b.workspaces[0].id.clone();
    }
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AgentKind, ConsoleNode};

    fn sample() -> Board {
        let mut b = Board::default();
        b.workspaces[0].consoles.push(ConsoleNode {
            id: "c1".into(),
            title: "api".into(),
            agent: AgentKind::ClaudeCode,
            cwd: "/tmp".into(),
            x: 1.0,
            y: 2.0,
            width: 640.0,
            height: 400.0,
            group: None,
            agent_session: Some("s".into()),
            loop_cfg: None,
        });
        b
    }

    #[test]
    fn fresh_then_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path()).unwrap();
        assert_eq!(s.load().unwrap().1, LoadOutcome::Fresh);
        s.save(&sample()).unwrap();
        let (b, o) = s.load().unwrap();
        assert_eq!(o, LoadOutcome::Loaded);
        assert_eq!(b, sample());
    }

    #[test]
    fn rotates_at_most_n_backups() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path()).unwrap();
        for _ in 0..9 {
            s.save(&sample()).unwrap();
        }
        assert!(s.backup(BACKUPS).exists());
        assert!(!s.backup(BACKUPS + 1).exists());
    }

    #[test]
    fn recovers_from_backup_when_main_corrupt() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path()).unwrap();
        s.save(&sample()).unwrap();
        s.save(&sample()).unwrap();
        fs::write(s.path(), b"{ not json").unwrap();
        let (b, o) = s.load().unwrap();
        assert_eq!(o, LoadOutcome::RecoveredFromBackup(1));
        assert_eq!(b, sample());
    }

    #[test]
    fn rejects_future_version() {
        let e = migrate(json!({"version": 99})).unwrap_err();
        assert!(matches!(e, Error::UnsupportedVersion { found: 99, .. }));
    }

    #[test]
    fn migrates_v1_single_workspace() {
        let v1 = json!({
            "version": 1, "name": "Main",
            "viewport": {"x": 5.0, "y": 6.0, "zoom": 0.5},
            "consoles": [{"id":"c1","title":"api","agent":{"kind":"codex"},"cwd":"C:/x",
                          "x":0.0,"y":0.0,"width":700.0,"height":400.0}]
        });
        let b = migrate(v1).unwrap();
        assert_eq!(b.version, 2);
        assert_eq!(b.active, "ws-main");
        assert_eq!(b.workspaces.len(), 1);
        assert_eq!(b.workspaces[0].viewport.zoom, 0.5);
        assert_eq!(b.workspaces[0].consoles[0].agent, AgentKind::Codex);
        assert!(!b.presets.is_empty());
    }

    #[test]
    fn repairs_dangling_active_tab() {
        let b = Board {
            active: "gone".into(),
            ..Default::default()
        };
        let fixed = migrate(serde_json::to_value(&b).unwrap()).unwrap();
        assert_eq!(fixed.active, "ws-main");
    }
}

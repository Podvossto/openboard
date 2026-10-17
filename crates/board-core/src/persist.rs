//! Crash-safe workspace persistence: write temp → fsync → rename, keep N rotating backups,
//! fall back to the newest readable backup if the main file is corrupt.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::model::{Workspace, WORKSPACE_VERSION};
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

    pub fn load(&self) -> Result<(Workspace, LoadOutcome)> {
        let main = self.path();
        if !main.exists() {
            return Ok((Workspace::default(), LoadOutcome::Fresh));
        }
        match read(&main) {
            Ok(ws) => Ok((ws, LoadOutcome::Loaded)),
            Err(e @ Error::UnsupportedVersion { .. }) => Err(e),
            Err(e) => {
                tracing::warn!("workspace unreadable ({e}); trying backups");
                for n in 1..=BACKUPS {
                    if let Ok(ws) = read(&self.backup(n)) {
                        return Ok((ws, LoadOutcome::RecoveredFromBackup(n)));
                    }
                }
                Err(e)
            }
        }
    }

    pub fn save(&self, ws: &Workspace) -> Result<()> {
        let main = self.path();
        let tmp = self.dir.join(format!("{FILE}.tmp"));
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&serde_json::to_vec_pretty(ws)?)?;
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

fn read(p: &Path) -> Result<Workspace> {
    let raw: serde_json::Value = serde_json::from_slice(&fs::read(p)?)?;
    migrate(raw)
}

/// Upgrade older on-disk versions. v1 is the first version, so only validation for now.
pub fn migrate(raw: serde_json::Value) -> Result<Workspace> {
    let found = raw.get("version").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if found > WORKSPACE_VERSION {
        return Err(Error::UnsupportedVersion {
            found,
            max: WORKSPACE_VERSION,
        });
    }
    let mut ws: Workspace = serde_json::from_value(raw)?;
    ws.version = WORKSPACE_VERSION;
    Ok(ws)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AgentKind, ConsoleNode};

    fn sample() -> Workspace {
        let mut ws = Workspace::default();
        ws.consoles.push(ConsoleNode {
            id: "c1".into(),
            title: "api".into(),
            agent: AgentKind::ClaudeCode,
            cwd: "/tmp".into(),
            x: 1.0,
            y: 2.0,
            width: 640.0,
            height: 400.0,
            agent_session: Some("s".into()),
        });
        ws
    }

    #[test]
    fn fresh_then_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path()).unwrap();
        assert_eq!(s.load().unwrap().1, LoadOutcome::Fresh);
        s.save(&sample()).unwrap();
        let (ws, o) = s.load().unwrap();
        assert_eq!(o, LoadOutcome::Loaded);
        assert_eq!(ws, sample());
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
        let (ws, o) = s.load().unwrap();
        assert_eq!(o, LoadOutcome::RecoveredFromBackup(1));
        assert_eq!(ws, sample());
    }

    #[test]
    fn rejects_future_version() {
        let e = migrate(serde_json::json!({"version": 99, "name": "x"})).unwrap_err();
        assert!(matches!(e, Error::UnsupportedVersion { found: 99, .. }));
    }
}

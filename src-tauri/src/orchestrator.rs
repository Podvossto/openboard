//! Real MCP tools for lead consoles: roster comes from the UI (`sync_roster`), effects go
//! through the PTY manager; spawning asks the UI (it owns board layout) via an event.

use std::collections::HashMap;
use std::sync::{mpsc, Arc};
use std::time::Duration;

use board_core::mcp::{find_target, Tools};
use board_core::pty::PtyManager;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::events::TauriEvents;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterEntry {
    pub id: String,
    pub title: String,
    pub agent: String,
    #[serde(default)]
    pub group: Option<String>,
    /// orchestrator lead (gets console tools)
    #[serde(default)]
    pub lead: bool,
    /// tiles linked to this console: (id, kind, title)
    #[serde(default)]
    pub links: Vec<LinkedTile>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTile {
    pub id: String,
    pub kind: String,
    pub title: String,
}

/// A tile tool call waiting for the UI (which owns tile data) to apply it.
pub type PendingOps = Mutex<HashMap<String, mpsc::Sender<Result<String, String>>>>;

pub struct BoardTools {
    pub roster: Mutex<Vec<RosterEntry>>,
    pub pty: Arc<PtyManager<TauriEvents>>,
    pub app: AppHandle,
    pub pending: PendingOps,
}

/// The UI's answer to a `tile://op` request.
pub fn complete_op(tools: &BoardTools, op_id: &str, result: Result<String, String>) {
    if let Some(tx) = tools.pending.lock().remove(op_id) {
        let _ = tx.send(result);
    }
}

impl BoardTools {
    fn resolve(&self, target: &str) -> Result<RosterEntry, String> {
        let r = self.roster.lock();
        let pairs: Vec<(String, String)> =
            r.iter().map(|e| (e.id.clone(), e.title.clone())).collect();
        let id = find_target(target, &pairs).ok_or_else(|| {
            format!(
                "no console named `{target}`. Known: {}",
                r.iter()
                    .map(|e| e.title.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        Ok(r.iter().find(|e| e.id == id).cloned().expect("resolved"))
    }

    fn entry(&self, id: &str) -> Option<RosterEntry> {
        self.roster.lock().iter().find(|e| e.id == id).cloned()
    }

    fn status_str(&self, id: &str) -> String {
        match self.pty.status(id) {
            Some(s) => serde_json::to_value(s)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "unknown".into()),
            None => "exited".into(),
        }
    }
}

impl Tools for BoardTools {
    fn is_lead(&self, caller: &str) -> bool {
        self.entry(caller).is_some_and(|e| e.lead)
    }

    fn linked_kinds(&self, caller: &str) -> Vec<String> {
        let mut k: Vec<String> = self
            .entry(caller)
            .map(|e| e.links.into_iter().map(|l| l.kind).collect())
            .unwrap_or_default();
        k.sort();
        k.dedup();
        k
    }

    fn tile_op(&self, caller: &str, tool: &str, args: &Value) -> Result<String, String> {
        let me = self.entry(caller).ok_or("unknown console")?;
        if tool == "list_linked_tiles" {
            return Ok(serde_json::to_string_pretty(&me.links).unwrap_or_default());
        }
        // resolve the tile among THIS console's links only (title or id, case-insensitive)
        let want = args
            .get("tile")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let kind = board_core::mcp::TILE_TOOLS
            .iter()
            .find(|t| t.0 == tool)
            .map(|t| t.1)
            .unwrap_or("");
        let tile = me
            .links
            .iter()
            .filter(|l| l.kind == kind)
            .find(|l| l.id == want || l.title.eq_ignore_ascii_case(want))
            .ok_or_else(|| {
                format!(
                    "no linked {kind} tile `{want}`. Linked: {}",
                    me.links
                        .iter()
                        .filter(|l| l.kind == kind)
                        .map(|l| l.title.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?
            .clone();
        let op_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        self.pending.lock().insert(op_id.clone(), tx);
        self.app
            .emit(
                "tile://op",
                json!({ "opId": op_id, "from": caller, "tile": tile.id, "tool": tool, "args": args }),
            )
            .map_err(|e| e.to_string())?;
        let r = rx
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| Err("the board did not answer (is the app window open?)".into()));
        self.pending.lock().remove(&op_id);
        r
    }

    fn list(&self, caller: &str) -> Value {
        let r = self.roster.lock().clone();
        json!(r
            .iter()
            .map(|e| json!({
                "title": e.title,
                "agent": e.agent,
                "status": self.status_str(&e.id),
                "group": e.group,
                "you": e.id == caller,
            }))
            .collect::<Vec<_>>())
    }

    fn send(&self, caller: &str, target: &str, message: &str) -> Result<String, String> {
        let t = self.resolve(target)?;
        if t.id == caller {
            return Err("that is you — pick another console".into());
        }
        if !self.pty.is_running(&t.id) {
            return Err(format!(
                "`{}` is not running; ask the user to start it or spawn a new one",
                t.title
            ));
        }
        let st = self.status_str(&t.id);
        if st == "working" || st == "needsYou" {
            return Err(format!("`{}` is {st}; wait and try again later", t.title));
        }
        let body = if message.contains('\n') {
            format!("\x1b[200~{message}\x1b[201~")
        } else {
            message.to_string()
        };
        self.pty
            .write(&t.id, body.as_bytes())
            .map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(60));
        self.pty.write(&t.id, b"\r").map_err(|e| e.to_string())?;
        let _ = self
            .app
            .emit("orchestrator://sent", json!({ "from": caller, "to": t.id }));
        Ok(format!(
            "Sent to `{}`. Use read_console later to check its result.",
            t.title
        ))
    }

    fn read(&self, _caller: &str, target: &str, chars: usize) -> Result<String, String> {
        let t = self.resolve(target)?;
        let out = self
            .pty
            .transcript(&t.id, chars)
            .ok_or_else(|| format!("`{}` is not running", t.title))?;
        Ok(format!(
            "[{} · {}]\n{}",
            t.title,
            self.status_str(&t.id),
            out
        ))
    }

    fn spawn(&self, caller: &str, agent: &str, title: &str, task: &str) -> Result<String, String> {
        if self
            .roster
            .lock()
            .iter()
            .any(|e| e.title.eq_ignore_ascii_case(title))
        {
            return Err(format!("a console named `{title}` already exists"));
        }
        self.app
            .emit(
                "orchestrator://spawn",
                json!({ "from": caller, "agent": agent, "title": title, "task": task }),
            )
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "Creating `{title}` ({agent}). It needs a few seconds to start; {}",
            if task.is_empty() {
                "send it a task when list_consoles shows it resting."
            } else {
                "its first task will be sent once it is ready."
            }
        ))
    }
}

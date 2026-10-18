//! Hook bridge between agent CLIs and the app.
//!
//! - The app runs a loopback HTTP server ([`HookServer`]) protected by a random token.
//! - Each console's PTY gets env vars (`AGENT_BOARD_*`) pointing at it.
//! - Claude Code is launched with `--settings <file>` whose hooks run
//!   `"<agent-board.exe>" hook`, which forwards the hook JSON from stdin ([`run_client`]).
//!   The user's own Claude config is never modified.

use std::io::Read;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::Router;
use serde_json::{json, Value};

use crate::status::HookEvent;
use crate::{Error, Result};

pub const ENV_URL: &str = "AGENT_BOARD_HOOK_URL";
pub const ENV_TOKEN: &str = "AGENT_BOARD_TOKEN";
pub const ENV_CONSOLE: &str = "AGENT_BOARD_CONSOLE_ID";
const TOKEN_HEADER: &str = "x-agent-board-token";

/// `(console_id, event, agent_session_id)` — session id lets the UI track `/clear` & resume ids.
pub type HookHandler = Arc<dyn Fn(String, HookEvent, Option<String>) + Send + Sync>;

#[derive(Clone)]
struct Ctx {
    token: Arc<str>,
    handler: HookHandler,
}

pub struct HookServer {
    pub addr: SocketAddr,
    pub token: String,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl HookServer {
    /// Bind 127.0.0.1 on an ephemeral port and serve on the current tokio runtime.
    pub async fn start(handler: HookHandler) -> Result<Self> {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let ctx = Ctx {
            token: token.as_str().into(),
            handler,
        };
        let app = Router::new()
            .route("/hook/{console}", post(receive))
            .with_state(ctx);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
        tracing::info!(%addr, "hook server listening");
        Ok(Self {
            addr,
            token,
            shutdown: Some(tx),
        })
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Env vars to inject into a console's PTY.
    pub fn env_for(&self, console_id: &str) -> Vec<(String, String)> {
        vec![
            (ENV_URL.into(), self.url()),
            (ENV_TOKEN.into(), self.token.clone()),
            (ENV_CONSOLE.into(), console_id.into()),
        ]
    }
}

impl Drop for HookServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

async fn receive(
    State(ctx): State<Ctx>,
    Path(console): Path<String>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    let ok = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| constant_time_eq(t.as_bytes(), ctx.token.as_bytes()));
    if !ok {
        return StatusCode::UNAUTHORIZED;
    }
    let Ok(payload) = serde_json::from_str::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let session = payload
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    (ctx.handler)(console, HookEvent::parse(&payload), session);
    StatusCode::NO_CONTENT
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Claude Code `--settings` document that routes lifecycle hooks to `hook_command`.
pub fn claude_settings(hook_command: &str) -> Value {
    let cmd = json!([{ "type": "command", "command": hook_command, "timeout": 5 }]);
    json!({
        "hooks": {
            "SessionStart":     [{ "hooks": cmd }],
            "UserPromptSubmit": [{ "hooks": cmd }],
            "PreToolUse":       [{ "matcher": "*", "hooks": cmd }],
            "PostToolUse":      [{ "matcher": "*", "hooks": cmd }],
            "PermissionRequest":[{ "matcher": "*", "hooks": cmd }],
            "Stop":             [{ "hooks": cmd }],
            "SubagentStop":     [{ "hooks": cmd }],
            "Notification":     [{ "matcher": "*", "hooks": cmd }]
        }
    })
}

/// Shell-safe hook command for an absolute executable path.
/// Forward slashes + double quotes work in Git Bash, cmd and sh alike.
pub fn hook_command(exe: &std::path::Path) -> String {
    format!("\"{}\" hook", exe.display().to_string().replace('\\', "/"))
}

/// Entry point for `agent-board hook`: forward stdin JSON to the running app.
/// Never fails loudly — a broken hook must not disturb the agent.
pub fn run_client() -> Result<()> {
    let (Ok(url), Ok(token), Ok(console)) = (
        std::env::var(ENV_URL),
        std::env::var(ENV_TOKEN),
        std::env::var(ENV_CONSOLE),
    ) else {
        return Ok(()); // launched outside Agent Board — nothing to do
    };
    let mut body = String::new();
    std::io::stdin().read_to_string(&mut body)?;
    forward(&url, &token, &console, body)
}

/// POST one hook payload to the app's hook server.
pub fn forward(url: &str, token: &str, console: &str, body: String) -> Result<()> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(2)))
        .build()
        .new_agent();
    agent
        .post(&format!("{url}/hook/{console}"))
        .header(TOKEN_HEADER, token)
        .header("content-type", "application/json")
        .send(body)
        .map_err(|e| Error::Hook(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

    #[tokio::test(flavor = "multi_thread")]
    async fn server_routes_authorized_events_only() {
        type Got = Vec<(String, HookEvent, Option<String>)>;
        let got: Arc<Mutex<Got>> = Arc::default();
        let g = got.clone();
        let srv = HookServer::start(Arc::new(move |c, e, s| g.lock().push((c, e, s))))
            .await
            .unwrap();
        let url = format!("{}/hook/c42", srv.url());
        let token = srv.token.clone();
        let codes = tokio::task::spawn_blocking(move || {
            let a = ureq::Agent::config_builder()
                .http_status_as_error(false)
                .build()
                .new_agent();
            let ok = a
                .post(&url)
                .header(TOKEN_HEADER, &token)
                .send(r#"{"hook_event_name":"Stop","session_id":"s1"}"#)
                .unwrap()
                .status();
            let bad = a
                .post(&url)
                .header(TOKEN_HEADER, "nope")
                .send("{}")
                .unwrap()
                .status();
            (ok.as_u16(), bad.as_u16())
        })
        .await
        .unwrap();
        assert_eq!(codes, (204, 401));
        assert_eq!(
            got.lock().as_slice(),
            &[("c42".to_string(), HookEvent::Stop, Some("s1".to_string()))]
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn client_forward_drives_status_end_to_end() {
        use crate::status::{Status, StatusTracker, Tuning};
        let tracker = Arc::new(Mutex::new(StatusTracker::new(true, Tuning::default())));
        let seen: Arc<Mutex<Vec<Status>>> = Arc::default();
        let (t, s) = (tracker.clone(), seen.clone());
        let srv = HookServer::start(Arc::new(move |_, ev, _| {
            if let Some(st) = t.lock().on_hook(&ev) {
                s.lock().push(st);
            }
        }))
        .await
        .unwrap();
        let (url, token) = (srv.url(), srv.token.clone());
        tokio::task::spawn_blocking(move || {
            for ev in [
                "SessionStart",
                "UserPromptSubmit",
                "PermissionRequest",
                "Stop",
            ] {
                let body = format!(r#"{{"hook_event_name":"{ev}","session_id":"s"}}"#);
                forward(&url, &token, "c1", body).unwrap();
            }
            assert!(forward(&url, "wrong", "c1", "{}".into()).is_err());
        })
        .await
        .unwrap();
        assert_eq!(
            seen.lock().as_slice(),
            &[
                Status::Resting,
                Status::Working,
                Status::NeedsYou,
                Status::Resting
            ]
        );
    }

    #[test]
    fn settings_cover_status_events() {
        let s = claude_settings("x hook");
        for ev in [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PermissionRequest",
            "Stop",
            "Notification",
        ] {
            assert_eq!(s["hooks"][ev][0]["hooks"][0]["command"], "x hook", "{ev}");
        }
    }

    #[test]
    fn hook_command_normalizes_windows_paths() {
        let p = std::path::Path::new(r"C:\Program Files\Agent Board\agent-board.exe");
        assert_eq!(
            hook_command(p),
            r#""C:/Program Files/Agent Board/agent-board.exe" hook"#
        );
    }
}

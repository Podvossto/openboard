//! Manual check of the orchestrator MCP server against a real `claude -p`.
//! Prints the --mcp-config JSON on stdout, logs tool calls to stderr, exits after 120s.
use std::sync::Arc;

use board_core::hooks::HookServer;
use serde_json::{json, Value};

struct T;
impl board_core::mcp::Tools for T {
    fn list(&self, caller: &str) -> Value {
        eprintln!("TOOL list_consoles caller={caller}");
        json!([
            {"title": "lead", "agent": "claude", "status": "working", "you": true},
            {"title": "reviewer", "agent": "codex", "status": "resting", "you": false},
            {"title": "tests", "agent": "shell", "status": "resting", "you": false}
        ])
    }
    fn send(&self, _: &str, t: &str, m: &str) -> Result<String, String> {
        eprintln!("TOOL send_to_console target={t} message={m}");
        Ok(format!("Sent to {t}."))
    }
    fn read(&self, _: &str, t: &str, _: usize) -> Result<String, String> {
        eprintln!("TOOL read_console target={t}");
        Ok("12 passed, 0 failed".into())
    }
    fn spawn(&self, _: &str, a: &str, t: &str, _: &str) -> Result<String, String> {
        eprintln!("TOOL spawn_console {a} {t}");
        Ok("spawned".into())
    }
}

#[tokio::main]
async fn main() {
    let srv = HookServer::start(Arc::new(|_, _, _| {})).await.unwrap();
    srv.set_tools(Arc::new(T));
    println!(
        "{}",
        board_core::mcp::claude_mcp_config(&srv.url(), &srv.token, "lead-1")
    );
    tokio::time::sleep(std::time::Duration::from_secs(120)).await;
}

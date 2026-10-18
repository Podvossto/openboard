//! Orchestrator MCP server (streamable-HTTP JSON-RPC, served by the hook server).
//!
//! A "lead" console (Claude Code) is started with `--mcp-config` pointing at
//! `POST {hook_url}/mcp/{console_id}` (token header). Its tools let it see the board and
//! drive other consoles: list them, send them a task, read their output, spawn workers.
//! The protocol layer here is pure; the actual effects live in a [`Tools`] impl.

use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// Side effects the MCP tools need. `caller` is the lead console id.
pub trait Tools: Send + Sync {
    fn list(&self, caller: &str) -> Value;
    fn send(&self, caller: &str, target: &str, message: &str) -> Result<String, String>;
    fn read(&self, caller: &str, target: &str, chars: usize) -> Result<String, String>;
    fn spawn(&self, caller: &str, agent: &str, title: &str, task: &str) -> Result<String, String>;
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "list_consoles",
            "description": "List every console on the Agent Board: title, agent (claude/codex/shell/...), status (working, resting, needsYou, exited), group, and whether it is you. Call this first to see who can take work.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false}
        },
        {
            "name": "send_to_console",
            "description": "Type a message into another console and press Enter, exactly as a human would. Use it to hand a self-contained task to a worker agent. The target must be running and should be resting (not mid-task).",
            "inputSchema": {"type": "object", "properties": {
                "target": {"type": "string", "description": "Console title (case-insensitive) or id"},
                "message": {"type": "string", "description": "Full instruction for that agent"}
            }, "required": ["target", "message"], "additionalProperties": false}
        },
        {
            "name": "read_console",
            "description": "Read the recent terminal output of another console (ANSI stripped) to check its progress or result.",
            "inputSchema": {"type": "object", "properties": {
                "target": {"type": "string"},
                "chars": {"type": "integer", "description": "How many trailing characters (default 4000, max 20000)"}
            }, "required": ["target"], "additionalProperties": false}
        },
        {
            "name": "spawn_console",
            "description": "Create a new worker console next to you, optionally with a first task. agent: claude | codex | shell.",
            "inputSchema": {"type": "object", "properties": {
                "agent": {"type": "string", "enum": ["claude", "codex", "shell"]},
                "title": {"type": "string", "description": "Short unique name, e.g. tests-1"},
                "task": {"type": "string", "description": "Optional first message once it is ready"}
            }, "required": ["agent", "title"], "additionalProperties": false}
        }
    ])
}

fn text(s: impl Into<String>, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": s.into()}], "isError": is_error})
}

fn str_arg<'a>(a: &'a Value, k: &str) -> Result<&'a str, String> {
    a.get(k)
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("missing argument `{k}`"))
}

fn call(tools: &dyn Tools, caller: &str, name: &str, args: &Value) -> Value {
    let r = match name {
        "list_consoles" => {
            Ok(serde_json::to_string_pretty(&tools.list(caller)).unwrap_or_default())
        }
        "send_to_console" => (|| {
            let t = str_arg(args, "target")?;
            let m = str_arg(args, "message")?;
            tools.send(caller, t, m)
        })(),
        "read_console" => (|| {
            let t = str_arg(args, "target")?;
            let n = args
                .get("chars")
                .and_then(|v| v.as_u64())
                .unwrap_or(4000)
                .clamp(200, 20_000) as usize;
            tools.read(caller, t, n)
        })(),
        "spawn_console" => (|| {
            let a = str_arg(args, "agent")?;
            if !matches!(a, "claude" | "codex" | "shell") {
                return Err(format!("unknown agent `{a}`"));
            }
            let t = str_arg(args, "title")?;
            let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
            tools.spawn(caller, a, t, task)
        })(),
        other => Err(format!("unknown tool `{other}`")),
    };
    match r {
        Ok(s) => text(s, false),
        Err(e) => text(e, true),
    }
}

/// Handle one JSON-RPC message. `None` = notification (reply 202, no body).
pub fn handle(tools: &dyn Tools, caller: &str, req: &Value) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = id?; // notifications (no id) get no response
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": req.pointer("/params/protocolVersion").and_then(|v| v.as_str()).unwrap_or(PROTOCOL_VERSION),
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "agent-board", "version": env!("CARGO_PKG_VERSION")},
            "instructions": "You can coordinate the other consoles on this Agent Board. Use list_consoles, then send_to_console to delegate, read_console to check results."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tool_defs()})),
        "tools/call" => {
            let name = req
                .pointer("/params/name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let args = req
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            Ok(call(tools, caller, name, &args))
        }
        m => Err(json!({"code": -32601, "message": format!("method not found: {m}")})),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
    })
}

/// `--mcp-config` JSON for a lead console.
pub fn claude_mcp_config(hook_url: &str, token: &str, console_id: &str) -> Value {
    json!({"mcpServers": {"agent-board": {
        "type": "http",
        "url": format!("{hook_url}/mcp/{console_id}"),
        "headers": {"x-agent-board-token": token}
    }}})
}

pub const LEAD_PROMPT: &str = "You are the orchestrator (lead) of a team of AI coding agents on Agent Board. \
Break the user's goal into self-contained tasks and delegate them with the agent-board MCP tools: \
list_consoles to see the team, send_to_console to assign work (one clear task per message, include file paths and acceptance criteria), \
read_console to check progress and results, spawn_console if you need more workers. \
Do not assign work to consoles that are 'working' or 'needsYou'. Summarise results for the user when the team is done.";

/// Resolve a target by id, then case-insensitive title.
pub fn find_target<'a>(target: &str, roster: &'a [(String, String)]) -> Option<&'a str> {
    let t = target.trim().trim_start_matches('@');
    roster
        .iter()
        .find(|(id, _)| id == t)
        .or_else(|| {
            roster
                .iter()
                .find(|(_, title)| title.eq_ignore_ascii_case(t))
        })
        .map(|(id, _)| id.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;

    #[derive(Default)]
    struct Fake(Mutex<Vec<String>>);
    impl Tools for Fake {
        fn list(&self, caller: &str) -> Value {
            json!([{"title": "api", "you": caller == "lead"}])
        }
        fn send(&self, _: &str, t: &str, m: &str) -> Result<String, String> {
            self.0.lock().push(format!("send {t}: {m}"));
            if t == "ghost" {
                Err("no console ghost".into())
            } else {
                Ok("sent".into())
            }
        }
        fn read(&self, _: &str, t: &str, n: usize) -> Result<String, String> {
            Ok(format!("{t}:{n}"))
        }
        fn spawn(&self, _: &str, a: &str, t: &str, task: &str) -> Result<String, String> {
            self.0.lock().push(format!("spawn {a} {t} {task}"));
            Ok("ok".into())
        }
    }

    fn rpc(f: &Fake, v: Value) -> Value {
        handle(f, "lead", &v).unwrap()
    }

    #[test]
    fn initialize_and_list_tools() {
        let f = Fake::default();
        let r = rpc(
            &f,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}),
        );
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert!(handle(
            &f,
            "lead",
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .is_none());
        let t = rpc(&f, json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
        let names: Vec<_> = t["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "list_consoles",
                "send_to_console",
                "read_console",
                "spawn_console"
            ]
        );
    }

    #[test]
    fn tool_calls_route_and_validate() {
        let f = Fake::default();
        let call = |name: &str, args: Value| {
            rpc(
                &f,
                json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":name,"arguments":args}}),
            )
        };
        let r = call("list_consoles", json!({}));
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"you\": true"));
        assert_eq!(
            call(
                "send_to_console",
                json!({"target":"api","message":"run tests"})
            )["result"]["isError"],
            false
        );
        assert_eq!(
            call("send_to_console", json!({"target":"ghost","message":"x"}))["result"]["isError"],
            true
        );
        assert_eq!(
            call("send_to_console", json!({"target":"api"}))["result"]["content"][0]["text"],
            "missing argument `message`"
        );
        assert_eq!(
            call("read_console", json!({"target":"api","chars":5}))["result"]["content"][0]["text"],
            "api:200"
        );
        assert_eq!(
            call("spawn_console", json!({"agent":"gpt","title":"x"}))["result"]["isError"],
            true
        );
        call(
            "spawn_console",
            json!({"agent":"codex","title":"rev","task":"review"}),
        );
        assert_eq!(
            f.0.lock().as_slice(),
            [
                "send api: run tests",
                "send ghost: x",
                "spawn codex rev review"
            ]
        );
        let unknown = rpc(
            &f,
            json!({"jsonrpc":"2.0","id":9,"method":"resources/list"}),
        );
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn config_and_targets() {
        let c = claude_mcp_config("http://127.0.0.1:5", "tok", "c1");
        assert_eq!(
            c["mcpServers"]["agent-board"]["url"],
            "http://127.0.0.1:5/mcp/c1"
        );
        assert_eq!(
            c["mcpServers"]["agent-board"]["headers"]["x-agent-board-token"],
            "tok"
        );
        let roster = vec![
            ("id1".to_string(), "API".to_string()),
            ("id2".to_string(), "web".to_string()),
        ];
        assert_eq!(find_target("@api", &roster), Some("id1"));
        assert_eq!(find_target("id2", &roster), Some("id2"));
        assert_eq!(find_target("nope", &roster), None);
    }
}

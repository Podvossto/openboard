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
    /// Orchestrator lead? Only leads get the console tools.
    fn is_lead(&self, _caller: &str) -> bool {
        true
    }
    /// Kinds of tiles linked to `caller` ("kanban" | "checklist" | "calendar").
    fn linked_kinds(&self, _caller: &str) -> Vec<String> {
        Vec::new()
    }
    /// Run a tile tool (see [`TILE_TOOLS`]) against a tile linked to `caller`.
    fn tile_op(&self, _caller: &str, _tool: &str, _args: &Value) -> Result<String, String> {
        Err("no tiles are linked to this console".into())
    }
}

/// Tile tools: (name, tile kind or "" for any, description, extra properties, required).
type TileTool = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
);

/// Tools an agent gets for the board tiles linked to its console.
pub const TILE_TOOLS: &[TileTool] = &[
    ("list_linked_tiles", "", "List the board tiles (kanban / checklist / calendar) linked to your console: title, kind and id. Call this first.", "{}", &[]),
    ("kanban_list", "kanban", "Show a kanban board: columns and their cards (with ids).", r#"{"tile":{"type":"string","description":"Tile title or id"}}"#, &["tile"]),
    ("kanban_add_card", "kanban", "Add a card to a kanban column (default: the first column).", r#"{"tile":{"type":"string"},"text":{"type":"string"},"column":{"type":"string","description":"Column name or id (optional)"}}"#, &["tile", "text"]),
    ("kanban_move_card", "kanban", "Move a card to another column (e.g. to Doing / Done).", r#"{"tile":{"type":"string"},"card":{"type":"string","description":"Card id or exact text"},"column":{"type":"string"}}"#, &["tile", "card", "column"]),
    ("kanban_update_card", "kanban", "Change a card's text.", r#"{"tile":{"type":"string"},"card":{"type":"string"},"text":{"type":"string"}}"#, &["tile", "card", "text"]),
    ("kanban_delete_card", "kanban", "Delete a card.", r#"{"tile":{"type":"string"},"card":{"type":"string"}}"#, &["tile", "card"]),
    ("checklist_list", "checklist", "Show a checklist's items (with ids and done state).", r#"{"tile":{"type":"string"}}"#, &["tile"]),
    ("checklist_add", "checklist", "Add an item to a checklist.", r#"{"tile":{"type":"string"},"text":{"type":"string"}}"#, &["tile", "text"]),
    ("checklist_toggle", "checklist", "Tick or untick an item (done defaults to true).", r#"{"tile":{"type":"string"},"item":{"type":"string","description":"Item id or exact text"},"done":{"type":"boolean"}}"#, &["tile", "item"]),
    ("checklist_delete", "checklist", "Delete a checklist item.", r#"{"tile":{"type":"string"},"item":{"type":"string"}}"#, &["tile", "item"]),
    ("calendar_list", "calendar", "List calendar events, optionally between two dates (YYYY-MM-DD).", r#"{"tile":{"type":"string"},"from":{"type":"string"},"to":{"type":"string"}}"#, &["tile"]),
    ("calendar_add_event", "calendar", "Add an event (date YYYY-MM-DD, optional time HH:MM).", r#"{"tile":{"type":"string"},"title":{"type":"string"},"date":{"type":"string"},"time":{"type":"string"}}"#, &["tile", "title", "date"]),
    ("calendar_update_event", "calendar", "Change an event's title, date or time.", r#"{"tile":{"type":"string"},"event":{"type":"string","description":"Event id or exact title"},"title":{"type":"string"},"date":{"type":"string"},"time":{"type":"string"}}"#, &["tile", "event"]),
    ("calendar_delete_event", "calendar", "Delete an event.", r#"{"tile":{"type":"string"},"event":{"type":"string"}}"#, &["tile", "event"]),
];

const LEAD_TOOLS: &[&str] = &[
    "list_consoles",
    "send_to_console",
    "read_console",
    "spawn_console",
];

/// Tile tool names usable with these linked kinds (always includes list_linked_tiles).
pub fn tile_tool_names(kinds: &[String]) -> Vec<&'static str> {
    if kinds.is_empty() {
        return Vec::new();
    }
    TILE_TOOLS
        .iter()
        .filter(|t| t.1.is_empty() || kinds.iter().any(|k| k == t.1))
        .map(|t| t.0)
        .collect()
}

fn tile_defs(kinds: &[String]) -> Vec<Value> {
    let names = tile_tool_names(kinds);
    TILE_TOOLS
        .iter()
        .filter(|t| names.contains(&t.0))
        .map(|(name, _, desc, props, req)| {
            let props: Value = serde_json::from_str(props).expect("static schema");
            json!({"name": name, "description": desc, "inputSchema": {
                "type": "object", "properties": props, "required": req, "additionalProperties": false
            }})
        })
        .collect()
}

/// `--allowedTools` value for a console (MCP tools are named `mcp__agent-board__<tool>`).
pub fn allowed_tools(lead: bool, kinds: &[String]) -> String {
    let lead_names = if lead { LEAD_TOOLS } else { &[] };
    lead_names
        .iter()
        .copied()
        .chain(tile_tool_names(kinds))
        .map(|n| format!("mcp__agent-board__{n}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// System-prompt addition telling an agent it lives on Agent Board and what it may touch.
/// `tiles` = (kind, title). Empty when nothing is linked.
pub fn tiles_prompt(tiles: &[(String, String)]) -> String {
    if tiles.is_empty() {
        return String::new();
    }
    let list = tiles
        .iter()
        .map(|(k, t)| format!("{k} \"{t}\""))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "You are running inside Agent Board, a visual board of AI agent consoles. The user linked these board tiles to you: {list}. \
When the user asks you to plan, track or schedule work (\"add a card\", \"move it to Done\", \"tick that off\", \"put it on the calendar\"), \
use the agent-board MCP tools (list_linked_tiles first, then kanban_* / checklist_* / calendar_*) — the board updates live for the user. \
Keep cards short; move cards as your work progresses."
    )
}

fn tool_defs(tools: &dyn Tools, caller: &str) -> Value {
    let mut defs: Vec<Value> = if tools.is_lead(caller) {
        lead_defs()
    } else {
        Vec::new()
    };
    defs.extend(tile_defs(&tools.linked_kinds(caller)));
    Value::Array(defs)
}

fn lead_defs() -> Vec<Value> {
    let Value::Array(v) = json!([
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
    ]) else {
        unreachable!()
    };
    v
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
    if LEAD_TOOLS.contains(&name) && !tools.is_lead(caller) {
        return text(
            format!("`{name}` is only available to orchestrator leads"),
            true,
        );
    }
    if let Some(t) = TILE_TOOLS.iter().find(|t| t.0 == name) {
        if !tile_tool_names(&tools.linked_kinds(caller)).contains(&t.0) {
            return text(
                format!(
                    "no {} tile is linked to this console",
                    if t.1.is_empty() { "board" } else { t.1 }
                ),
                true,
            );
        }
        for req in t.4 {
            if let Err(e) = str_arg(args, req) {
                return text(e, true);
            }
        }
        return match tools.tile_op(caller, name, args) {
            Ok(s) => text(s, false),
            Err(e) => text(e, true),
        };
    }
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
            "instructions": "Agent Board tools. Leads: list_consoles, send_to_console, read_console, spawn_console. Linked tiles: list_linked_tiles, then kanban_* / checklist_* / calendar_*."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tool_defs(tools, caller)})),
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
list_consoles to see the team (consoles with yourTeam=true are yours; prefer them), send_to_console to assign work (one clear task per message, include file paths and acceptance criteria), \
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

    struct Linked;
    impl Tools for Linked {
        fn list(&self, _: &str) -> Value {
            json!([])
        }
        fn send(&self, _: &str, _: &str, _: &str) -> Result<String, String> {
            Ok("sent".into())
        }
        fn read(&self, _: &str, _: &str, _: usize) -> Result<String, String> {
            Ok(String::new())
        }
        fn spawn(&self, _: &str, _: &str, _: &str, _: &str) -> Result<String, String> {
            Ok(String::new())
        }
        fn is_lead(&self, c: &str) -> bool {
            c == "lead"
        }
        fn linked_kinds(&self, c: &str) -> Vec<String> {
            if c == "worker" {
                vec!["kanban".into()]
            } else {
                vec![]
            }
        }
        fn tile_op(&self, c: &str, tool: &str, a: &Value) -> Result<String, String> {
            Ok(format!("{c}:{tool}:{}", a["text"].as_str().unwrap_or("")))
        }
    }

    fn rpc2(t: &dyn Tools, caller: &str, method: &str, params: Value) -> Value {
        handle(
            t,
            caller,
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}),
        )
        .unwrap()
    }
    fn names(v: &Value) -> Vec<String> {
        v["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn tools_list_follows_role_and_links() {
        let w = names(&rpc2(&Linked, "worker", "tools/list", json!({})));
        assert!(w.contains(&"kanban_add_card".to_string()));
        assert!(w.contains(&"list_linked_tiles".to_string()));
        assert!(!w
            .iter()
            .any(|n| n.starts_with("calendar_") || n == "send_to_console"));
        let l = names(&rpc2(&Linked, "lead", "tools/list", json!({})));
        assert!(
            l.contains(&"send_to_console".to_string())
                && !l.iter().any(|n| n.starts_with("kanban"))
        );
        assert!(names(&rpc2(&Linked, "other", "tools/list", json!({}))).is_empty());
    }

    #[test]
    fn tile_calls_are_gated_and_validated() {
        let ok = rpc2(
            &Linked,
            "worker",
            "tools/call",
            json!({"name":"kanban_add_card","arguments":{"tile":"Sprint","text":"fix login"}}),
        );
        assert_eq!(
            ok["result"]["content"][0]["text"],
            "worker:kanban_add_card:fix login"
        );
        assert_eq!(ok["result"]["isError"], false);
        let missing = rpc2(
            &Linked,
            "worker",
            "tools/call",
            json!({"name":"kanban_add_card","arguments":{"tile":"Sprint"}}),
        );
        assert_eq!(missing["result"]["isError"], true);
        let wrong_kind = rpc2(
            &Linked,
            "worker",
            "tools/call",
            json!({"name":"calendar_add_event","arguments":{"tile":"x","title":"t","date":"2026-10-20"}}),
        );
        assert!(wrong_kind["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("no calendar tile"));
        let not_lead = rpc2(
            &Linked,
            "worker",
            "tools/call",
            json!({"name":"send_to_console","arguments":{"target":"a","message":"b"}}),
        );
        assert!(not_lead["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("only available"));
    }

    #[test]
    fn allowed_tools_and_prompt() {
        assert_eq!(allowed_tools(false, &[]), "");
        let a = allowed_tools(true, &["checklist".into()]);
        assert!(a.starts_with("mcp__agent-board__list_consoles,"));
        assert!(a.contains("mcp__agent-board__checklist_toggle") && !a.contains("kanban"));
        assert!(tiles_prompt(&[]).is_empty());
        let p = tiles_prompt(&[("kanban".into(), "Sprint".into())]);
        assert!(p.contains("Agent Board") && p.contains("kanban \"Sprint\""));
        // every static schema parses and lists its required args
        for t in TILE_TOOLS {
            let v: Value = serde_json::from_str(t.3).unwrap();
            for r in t.4 {
                assert!(v.get(r).is_some(), "{} missing {r}", t.0);
            }
        }
    }
}

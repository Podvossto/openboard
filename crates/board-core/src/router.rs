//! AI dispatcher for the command bar: turn a free-form instruction ("pass this task to
//! codex", "have the testers run the suite") into a concrete plan over the board's consoles.
//!
//! The LLM call itself lives in the Tauri layer (`claude -p`, the user's own subscription);
//! this module only builds the prompt and parses/validates the answer, so it is fully testable.

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// What the dispatcher knows about one console (sent from the UI).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterConsole {
    pub id: String,
    pub title: String,
    /// "claude" | "codex" | "shell" | program name
    pub agent: String,
    /// working | resting | needsYou | starting | exited
    pub status: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub focused: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Plan {
    /// Send `message` to every console id in `targets`.
    Send {
        targets: Vec<String>,
        message: String,
        reason: String,
    },
    /// Summarise `from` and hand the work to `to`.
    Handoff {
        from: String,
        to: String,
        reason: String,
    },
    /// Nothing sensible to do — show `reason` to the user.
    None { reason: String },
}

pub fn router_prompt(instruction: &str, consoles: &[RouterConsole]) -> String {
    let mut roster = String::new();
    for c in consoles {
        roster.push_str(&format!(
            "- title: {:?} | agent: {} | status: {}{}{}\n",
            c.title,
            c.agent,
            c.status,
            c.group
                .as_deref()
                .map(|g| format!(" | group: {g:?}"))
                .unwrap_or_default(),
            if c.focused {
                " | FOCUSED (the console the user last clicked)"
            } else {
                ""
            },
        ));
    }
    format!(
        r#"You route instructions to AI coding-agent consoles on a board. Decide what to do with the user's instruction.

Consoles:
{roster}
User instruction: {instruction:?}

Rules:
- Only consoles with status working, resting or needsYou are running; never target exited/starting consoles.
- "pass/hand this (task) to X" or "let X continue" means a handoff FROM the focused console (or the one clearly meant) TO the console matching X (by title, agent or group).
- Otherwise pick the console(s) the instruction is for and rewrite it as a direct, self-contained message to them (drop the routing words like "tell codex to").
- If the instruction names an agent type (claude, codex, shell) pick running consoles of that type; a group name means all its running members.
- Consoles with agent "shell" are plain terminals: the message must be a literal shell command (e.g. `npm test`), never prose. Do not mix shell and AI-agent consoles in one send if they would need different messages; prefer the AI agents.
- If nothing fits, use action "none" with a short reason.

Answer with ONLY one JSON object, no prose, no code fence. One of:
{{"action":"send","targets":["<console title>", ...],"message":"<text to send>","reason":"<short why>"}}
{{"action":"handoff","from":"<console title>","to":"<console title>","reason":"<short why>"}}
{{"action":"none","reason":"<short why>"}}"#
    )
}

#[derive(Deserialize)]
struct RawPlan {
    action: String,
    #[serde(default)]
    targets: Vec<String>,
    #[serde(default)]
    message: String,
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: String,
    #[serde(default)]
    reason: String,
}

/// First balanced `{ … }` in the model output (tolerates prose and ``` fences).
fn extract_json(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, ch) in raw[start..].char_indices() {
        if in_str {
            match (esc, ch) {
                (true, _) => esc = false,
                (false, '\\') => esc = true,
                (false, '"') => in_str = false,
                _ => {}
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&raw[start..start + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

fn is_running(c: &RouterConsole) -> bool {
    matches!(c.status.as_str(), "working" | "resting" | "needsYou")
}

/// Resolve a model-written title back to a console (exact, then case-insensitive).
fn find<'a>(name: &str, consoles: &'a [RouterConsole]) -> Option<&'a RouterConsole> {
    let n = name.trim().trim_start_matches('@');
    consoles
        .iter()
        .find(|c| c.title == n)
        .or_else(|| consoles.iter().find(|c| c.title.eq_ignore_ascii_case(n)))
}

pub fn parse_plan(raw: &str, consoles: &[RouterConsole]) -> Result<Plan> {
    let json = extract_json(raw)
        .ok_or_else(|| Error::Hook(format!("dispatcher gave no JSON: {}", raw.trim())))?;
    let p: RawPlan = serde_json::from_str(json)?;
    match p.action.as_str() {
        "send" => {
            let mut ids = Vec::new();
            for t in &p.targets {
                let c = find(t, consoles).ok_or_else(|| {
                    Error::Hook(format!("dispatcher picked unknown console {t:?}"))
                })?;
                if is_running(c) && !ids.contains(&c.id) {
                    ids.push(c.id.clone());
                }
            }
            if ids.is_empty() {
                return Ok(Plan::None {
                    reason: "No running console matched.".into(),
                });
            }
            if p.message.trim().is_empty() {
                return Ok(Plan::None {
                    reason: "Dispatcher produced an empty message.".into(),
                });
            }
            Ok(Plan::Send {
                targets: ids,
                message: p.message.trim().into(),
                reason: p.reason,
            })
        }
        "handoff" => {
            let from = find(&p.from, consoles)
                .ok_or_else(|| Error::Hook(format!("unknown console {:?}", p.from)))?;
            let to = find(&p.to, consoles)
                .ok_or_else(|| Error::Hook(format!("unknown console {:?}", p.to)))?;
            if from.id == to.id {
                return Ok(Plan::None {
                    reason: "Handoff needs two different consoles.".into(),
                });
            }
            if !is_running(from) || !is_running(to) {
                return Ok(Plan::None {
                    reason: format!("{} or {} is not running.", from.title, to.title),
                });
            }
            Ok(Plan::Handoff {
                from: from.id.clone(),
                to: to.id.clone(),
                reason: p.reason,
            })
        }
        "none" => Ok(Plan::None {
            reason: if p.reason.is_empty() {
                "Nothing to do.".into()
            } else {
                p.reason
            },
        }),
        other => Err(Error::Hook(format!(
            "dispatcher returned unknown action {other:?}"
        ))),
    }
}

/// Prompt for a loop's goal check: has the console reached `goal`? (`claude -p`)
pub fn goal_prompt(goal: &str, title: &str, transcript: &str) -> String {
    format!(
        r#"You check whether an AI coding agent's work has reached a goal.

Goal: {goal:?}

Recent terminal output of console {title:?} (newest last):
<<<
{transcript}
>>>

Answer with ONLY one JSON object, no prose:
{{"done": true|false, "reason": "<one short sentence>"}}
Say done=true only when the output clearly shows the goal is met (e.g. tests passing, task reported complete)."#
    )
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct GoalVerdict {
    pub done: bool,
    #[serde(default)]
    pub reason: String,
}

pub fn parse_goal(raw: &str) -> Result<GoalVerdict> {
    let json = extract_json(raw)
        .ok_or_else(|| Error::Hook(format!("goal check gave no JSON: {}", raw.trim())))?;
    Ok(serde_json::from_str(json)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: &str, title: &str, agent: &str, status: &str) -> RouterConsole {
        RouterConsole {
            id: id.into(),
            title: title.into(),
            agent: agent.into(),
            status: status.into(),
            group: None,
            focused: false,
        }
    }

    fn board() -> Vec<RouterConsole> {
        let mut api = c("1", "api", "claude", "resting");
        api.focused = true;
        vec![
            api,
            c("2", "Reviewer", "codex", "resting"),
            c("3", "old", "shell", "exited"),
        ]
    }

    #[test]
    fn prompt_lists_consoles_and_focus() {
        let p = router_prompt("pass this to codex", &board());
        assert!(p.contains(r#"title: "api" | agent: claude | status: resting | FOCUSED"#));
        assert!(p.contains(r#"title: "Reviewer" | agent: codex"#));
        assert!(p.contains(r#""pass this to codex""#));
    }

    #[test]
    fn parses_handoff_with_fence_and_prose() {
        let raw = "Sure!\n```json\n{\"action\":\"handoff\",\"from\":\"api\",\"to\":\"reviewer\",\"reason\":\"codex reviews\"}\n```";
        assert_eq!(
            parse_plan(raw, &board()).unwrap(),
            Plan::Handoff {
                from: "1".into(),
                to: "2".into(),
                reason: "codex reviews".into()
            }
        );
    }

    #[test]
    fn send_skips_stopped_and_dedupes() {
        let raw =
            r#"{"action":"send","targets":["api","api","old"],"message":"run tests","reason":"x"}"#;
        assert_eq!(
            parse_plan(raw, &board()).unwrap(),
            Plan::Send {
                targets: vec!["1".into()],
                message: "run tests".into(),
                reason: "x".into()
            }
        );
        let only_stopped = r#"{"action":"send","targets":["old"],"message":"hi"}"#;
        assert!(matches!(
            parse_plan(only_stopped, &board()).unwrap(),
            Plan::None { .. }
        ));
    }

    #[test]
    fn braces_inside_strings_do_not_break_extraction() {
        let raw = r#"{"action":"send","targets":["api"],"message":"fix fn() { return 1 }","reason":""} trailing"#;
        match parse_plan(raw, &board()).unwrap() {
            Plan::Send { message, .. } => assert_eq!(message, "fix fn() { return 1 }"),
            p => panic!("{p:?}"),
        }
    }

    #[test]
    fn rejects_garbage_and_unknown_targets() {
        assert!(parse_plan("I can't do that", &board()).is_err());
        assert!(parse_plan(
            r#"{"action":"send","targets":["ghost"],"message":"x"}"#,
            &board()
        )
        .is_err());
        assert!(parse_plan(r#"{"action":"explode"}"#, &board()).is_err());
        assert_eq!(
            parse_plan(r#"{"action":"none","reason":"unclear"}"#, &board()).unwrap(),
            Plan::None {
                reason: "unclear".into()
            }
        );
    }

    #[test]
    fn goal_prompt_and_parse() {
        let p = goal_prompt("all tests pass", "api", "12 passed, 0 failed");
        assert!(p.contains(r#"Goal: "all tests pass""#) && p.contains("12 passed"));
        let v = parse_goal("```json\n{\"done\": true, \"reason\": \"0 failed\"}\n```").unwrap();
        assert!(v.done);
        assert_eq!(v.reason, "0 failed");
        assert!(!parse_goal(r#"{"done":false}"#).unwrap().done);
        assert!(parse_goal("maybe").is_err());
    }

    #[test]
    fn plan_json_shape() {
        let j = serde_json::to_value(Plan::None { reason: "r".into() }).unwrap();
        assert_eq!(j, serde_json::json!({"action":"none","reason":"r"}));
    }
}

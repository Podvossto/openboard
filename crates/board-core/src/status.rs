//! Per-console status: **working / resting / needs you / exited**.
//!
//! Signal sources, strongest first:
//! 1. *Hooks* (Claude Code) — lifecycle events incl. `PermissionRequest`,
//!    `PreToolUse(AskUserQuestion)` and typed `Notification`s.
//! 2. *Prompt detection* (all agents) — after output goes quiet, if the visible tail
//!    looks like a question/approval prompt → needs you. Fallback if hooks misfire and
//!    the only signal for Codex/shells.
//! 3. *Activity heuristic* (agents without hooks) — output soon after input = working,
//!    quiet = resting.
//!
//! Time is injected so the tracker is fully unit-testable.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::ansi;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Starting,
    Working,
    Resting,
    NeedsYou,
    Exited,
}

/// Hook events we understand (Claude Code `hook_event_name`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookEvent {
    SessionStart,
    UserPromptSubmit,
    PreToolUse {
        tool: String,
    },
    PostToolUse,
    PermissionRequest,
    Stop,
    /// `kind` = `notification_type` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`…)
    Notification {
        kind: String,
        message: String,
    },
    Other(String),
}

/// Tools that block on the human even though they are "tool use".
const ASKING_TOOLS: &[&str] = &["AskUserQuestion"];

impl HookEvent {
    pub fn parse(payload: &serde_json::Value) -> Self {
        let s = |k: &str| payload.get(k).and_then(|v| v.as_str()).unwrap_or_default();
        match s("hook_event_name") {
            "SessionStart" => Self::SessionStart,
            "UserPromptSubmit" => Self::UserPromptSubmit,
            "PreToolUse" => Self::PreToolUse {
                tool: s("tool_name").to_string(),
            },
            "PostToolUse" => Self::PostToolUse,
            "PermissionRequest" => Self::PermissionRequest,
            "Stop" | "SubagentStop" => Self::Stop,
            "Notification" => Self::Notification {
                kind: s("notification_type").to_string(),
                message: s("message").to_string(),
            },
            other => Self::Other(other.to_string()),
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::SessionStart => "SessionStart",
            Self::UserPromptSubmit => "UserPromptSubmit",
            Self::PreToolUse { .. } => "PreToolUse",
            Self::PostToolUse => "PostToolUse",
            Self::PermissionRequest => "PermissionRequest",
            Self::Stop => "Stop",
            Self::Notification { .. } => "Notification",
            Self::Other(n) => n,
        }
    }
}

/// Does the visible tail of a terminal look like it is waiting on a human decision?
pub fn looks_like_prompt(tail: &str) -> bool {
    let t = ansi::squash(tail).to_lowercase();
    // only the last few lines matter — older questions were already answered
    let recent: String = {
        let lines: Vec<&str> = t.lines().filter(|l| !l.trim().is_empty()).collect();
        let n = lines.len();
        lines[n.saturating_sub(12)..].join("\n")
    };
    const NEEDLES: &[&str] = &[
        "do you want to",
        "would you like to",
        "do you trust",
        "allow this",
        "allow command",
        "approve",
        "(y/n)",
        "[y/n]",
        "y/n?",
        "press enter to continue",
        "1. yes",
        "› 1.",
        "❯ 1.",
        "waiting for your input",
        "requires approval",
    ];
    NEEDLES.iter().any(|n| recent.contains(n))
}

#[derive(Debug, Clone, Copy)]
pub struct Tuning {
    /// Quiet period after which a heuristic console is considered resting.
    pub quiet: Duration,
    /// Quiet period before checking the tail for a prompt.
    pub prompt_quiet: Duration,
    /// Output within this window after user input counts as "working".
    pub input_window: Duration,
    /// Ignore output for this long after a resize (TUI redraws are not work).
    pub resize_grace: Duration,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            quiet: Duration::from_millis(2500),
            prompt_quiet: Duration::from_millis(700),
            input_window: Duration::from_secs(30),
            resize_grace: Duration::from_millis(400),
        }
    }
}

const TAIL_BYTES: usize = 4096;

pub struct StatusTracker {
    status: Status,
    hooks: bool,
    tuning: Tuning,
    last_output: Option<Instant>,
    last_input: Option<Instant>,
    suppress_until: Option<Instant>,
    tail: Vec<u8>,
    /// set when new output arrives; cleared once the tail has been checked
    tail_dirty: bool,
}

impl StatusTracker {
    pub fn new(hooks: bool, tuning: Tuning) -> Self {
        Self {
            status: Status::Starting,
            hooks,
            tuning,
            last_output: None,
            last_input: None,
            suppress_until: None,
            tail: Vec::new(),
            tail_dirty: false,
        }
    }

    pub fn status(&self) -> Status {
        self.status
    }

    fn set(&mut self, s: Status) -> Option<Status> {
        if self.status == Status::Exited || self.status == s {
            return None;
        }
        self.status = s;
        Some(s)
    }

    pub fn on_input(&mut self, now: Instant) -> Option<Status> {
        self.last_input = Some(now);
        // The prompt on screen is being answered — don't re-detect it.
        self.tail.clear();
        self.tail_dirty = false;
        if self.status == Status::NeedsYou {
            return self.set(Status::Working);
        }
        None
    }

    pub fn on_resize(&mut self, now: Instant) {
        self.suppress_until = Some(now + self.tuning.resize_grace);
    }

    pub fn on_output(&mut self, now: Instant, data: &[u8]) -> Option<Status> {
        if self.suppress_until.is_some_and(|t| now < t) {
            return None;
        }
        self.last_output = Some(now);
        self.tail.extend_from_slice(data);
        if self.tail.len() > TAIL_BYTES {
            let cut = self.tail.len() - TAIL_BYTES;
            self.tail.drain(..cut);
        }
        self.tail_dirty = true;
        if self.hooks {
            return if self.status == Status::Starting {
                self.set(Status::Resting)
            } else {
                None
            };
        }
        let recent_input = self
            .last_input
            .is_some_and(|t| now.duration_since(t) <= self.tuning.input_window);
        match self.status {
            Status::Starting => self.set(Status::Resting),
            Status::Resting if recent_input => self.set(Status::Working),
            _ => None,
        }
    }

    pub fn on_hook(&mut self, ev: &HookEvent) -> Option<Status> {
        match ev {
            HookEvent::SessionStart | HookEvent::Stop => self.set(Status::Resting),
            HookEvent::UserPromptSubmit | HookEvent::PostToolUse => self.set(Status::Working),
            HookEvent::PreToolUse { tool } if ASKING_TOOLS.contains(&tool.as_str()) => {
                self.set(Status::NeedsYou)
            }
            HookEvent::PreToolUse { .. } => self.set(Status::Working),
            HookEvent::PermissionRequest => self.set(Status::NeedsYou),
            HookEvent::Notification { kind, .. } => match kind.as_str() {
                // finished and idle — not a question
                "idle_prompt" | "auth_success" => None,
                _ => self.set(Status::NeedsYou),
            },
            HookEvent::Other(_) => None,
        }
    }

    pub fn on_exit(&mut self) -> Option<Status> {
        let changed = self.status != Status::Exited;
        self.status = Status::Exited;
        changed.then_some(Status::Exited)
    }

    /// Periodic tick: prompt detection (all agents) + activity decay (heuristic only).
    pub fn tick(&mut self, now: Instant) -> Option<Status> {
        if self.status == Status::Exited {
            return None;
        }
        let quiet_for = self.last_output.map(|t| now.duration_since(t));
        if self.tail_dirty
            && self.status != Status::NeedsYou
            && quiet_for.is_some_and(|q| q >= self.tuning.prompt_quiet)
        {
            self.tail_dirty = false;
            if looks_like_prompt(&ansi::strip(&self.tail)) {
                return self.set(Status::NeedsYou);
            }
        }
        if !self.hooks
            && self.status == Status::Working
            && quiet_for.is_some_and(|q| q >= self.tuning.quiet)
        {
            return self.set(Status::Resting);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn heuristic_cycle() {
        let t0 = Instant::now();
        let mut s = StatusTracker::new(false, Tuning::default());
        assert_eq!(s.on_output(t0, b"banner"), Some(Status::Resting));
        assert_eq!(s.on_output(t0 + ms(10), b"x"), None);
        s.on_input(t0 + ms(100));
        assert_eq!(
            s.on_output(t0 + ms(150), b"working..."),
            Some(Status::Working)
        );
        assert_eq!(s.tick(t0 + ms(1000)), None);
        assert_eq!(s.tick(t0 + ms(150) + ms(2500)), Some(Status::Resting));
    }

    #[test]
    fn resize_redraw_is_not_work() {
        let t0 = Instant::now();
        let mut s = StatusTracker::new(false, Tuning::default());
        s.on_output(t0, b"x");
        s.on_input(t0);
        s.on_resize(t0 + ms(10));
        assert_eq!(s.on_output(t0 + ms(50), b"redraw"), None);
        assert_eq!(s.status(), Status::Resting);
    }

    #[test]
    fn hooks_drive_claude() {
        let t0 = Instant::now();
        let mut s = StatusTracker::new(true, Tuning::default());
        assert_eq!(s.on_hook(&HookEvent::SessionStart), Some(Status::Resting));
        assert_eq!(
            s.on_hook(&HookEvent::UserPromptSubmit),
            Some(Status::Working)
        );
        assert_eq!(s.tick(t0 + Duration::from_secs(60)), None);
        assert_eq!(
            s.on_hook(&HookEvent::PermissionRequest),
            Some(Status::NeedsYou)
        );
        assert_eq!(s.on_input(t0), Some(Status::Working));
        assert_eq!(s.on_hook(&HookEvent::Stop), Some(Status::Resting));
    }

    #[test]
    fn ask_user_question_and_typed_notifications() {
        let mut s = StatusTracker::new(true, Tuning::default());
        s.on_hook(&HookEvent::UserPromptSubmit);
        let bash = HookEvent::PreToolUse {
            tool: "Bash".into(),
        };
        assert_eq!(s.on_hook(&bash), None); // still working
        let ask = HookEvent::PreToolUse {
            tool: "AskUserQuestion".into(),
        };
        assert_eq!(s.on_hook(&ask), Some(Status::NeedsYou));
        assert_eq!(s.on_hook(&HookEvent::PostToolUse), Some(Status::Working));
        s.on_hook(&HookEvent::Stop);
        let idle = HookEvent::Notification {
            kind: "idle_prompt".into(),
            message: String::new(),
        };
        assert_eq!(s.on_hook(&idle), None);
        let perm = HookEvent::Notification {
            kind: "permission_prompt".into(),
            message: String::new(),
        };
        assert_eq!(s.on_hook(&perm), Some(Status::NeedsYou));
    }

    #[test]
    fn prompt_detection_works_without_hooks_and_as_hook_fallback() {
        for hooks in [false, true] {
            let t0 = Instant::now();
            let mut s = StatusTracker::new(hooks, Tuning::default());
            s.on_output(t0, b"boot\n");
            s.on_input(t0 + ms(10));
            let screen = b"\x1b[1mBash command\x1b[0m\r\n  rm -rf build\r\n\x1b[33mDo you want to proceed?\x1b[0m\r\n\x1b[36m\xe2\x9d\xaf 1. Yes\x1b[0m\r\n  2. No";
            s.on_output(t0 + ms(20), screen);
            assert_eq!(s.tick(t0 + ms(300)), None, "not quiet yet (hooks={hooks})");
            assert_eq!(
                s.tick(t0 + ms(800)),
                Some(Status::NeedsYou),
                "hooks={hooks}"
            );
            // answering clears it, and the old question is not re-detected
            assert_eq!(s.on_input(t0 + ms(900)), Some(Status::Working));
            s.on_output(t0 + ms(950), b"ok running\n");
            assert_eq!(s.tick(t0 + ms(2000)), None);
        }
    }

    #[test]
    fn prompt_matcher() {
        assert!(looks_like_prompt("Allow command `npm test`? (y/n)"));
        assert!(looks_like_prompt(
            "Do you trust the files in this folder?\n> 1. Yes, proceed"
        ));
        assert!(!looks_like_prompt("Compiling 42 crates\n? for shortcuts"));
        let old = format!("Do you want to proceed?\n{}", "line\n".repeat(20));
        assert!(!looks_like_prompt(&old), "stale question scrolled away");
    }

    #[test]
    fn exited_is_terminal() {
        let mut s = StatusTracker::new(true, Tuning::default());
        assert_eq!(s.on_exit(), Some(Status::Exited));
        assert_eq!(s.on_hook(&HookEvent::UserPromptSubmit), None);
        assert_eq!(s.on_exit(), None);
    }

    #[test]
    fn parses_hook_payload() {
        let v = serde_json::json!({"hook_event_name": "Notification", "message": "hi", "notification_type": "permission_prompt"});
        assert_eq!(
            HookEvent::parse(&v),
            HookEvent::Notification {
                kind: "permission_prompt".into(),
                message: "hi".into()
            }
        );
        let v =
            serde_json::json!({"hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion"});
        assert_eq!(
            HookEvent::parse(&v),
            HookEvent::PreToolUse {
                tool: "AskUserQuestion".into()
            }
        );
        let v = serde_json::json!({"hook_event_name": "SubagentStop"});
        assert_eq!(HookEvent::parse(&v), HookEvent::Stop);
    }
}

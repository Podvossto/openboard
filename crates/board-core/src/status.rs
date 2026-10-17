//! Per-console status: **working / resting / needs you / exited**.
//!
//! Two signal sources:
//! - *Hooks* (authoritative) — Claude Code calls back into the app on lifecycle events.
//! - *Output heuristic* — for CLIs without hooks: output shortly after user input means
//!   working, a quiet period means resting.
//!
//! The tracker is pure (time is injected) so it is fully unit-testable.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

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
    PreToolUse,
    PostToolUse,
    Stop,
    /// `message` is the notification text (permission prompt vs. idle reminder).
    Notification {
        message: String,
    },
    Other(String),
}

impl HookEvent {
    pub fn parse(payload: &serde_json::Value) -> Self {
        let name = payload
            .get("hook_event_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        match name {
            "SessionStart" => Self::SessionStart,
            "UserPromptSubmit" => Self::UserPromptSubmit,
            "PreToolUse" => Self::PreToolUse,
            "PostToolUse" => Self::PostToolUse,
            "Stop" | "SubagentStop" => Self::Stop,
            "Notification" => Self::Notification {
                message: payload
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
            },
            other => Self::Other(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Tuning {
    /// Quiet period after which a heuristic console is considered resting.
    pub quiet: Duration,
    /// Output within this window after user input counts as "working".
    pub input_window: Duration,
    /// Ignore output for this long after a resize (TUI redraws are not work).
    pub resize_grace: Duration,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            quiet: Duration::from_millis(2500),
            input_window: Duration::from_secs(30),
            resize_grace: Duration::from_millis(400),
        }
    }
}

pub struct StatusTracker {
    status: Status,
    hooks: bool,
    tuning: Tuning,
    last_output: Option<Instant>,
    last_input: Option<Instant>,
    suppress_until: Option<Instant>,
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
        // Answering a prompt clears "needs you" immediately for any agent.
        if self.status == Status::NeedsYou {
            return self.set(Status::Working);
        }
        None
    }

    pub fn on_resize(&mut self, now: Instant) {
        self.suppress_until = Some(now + self.tuning.resize_grace);
    }

    pub fn on_output(&mut self, now: Instant) -> Option<Status> {
        if self.suppress_until.is_some_and(|t| now < t) {
            return None;
        }
        self.last_output = Some(now);
        if self.hooks {
            // Hooks are authoritative; only leave Starting on first output.
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
            HookEvent::UserPromptSubmit | HookEvent::PreToolUse | HookEvent::PostToolUse => {
                self.set(Status::Working)
            }
            HookEvent::Notification { message } => {
                // Claude sends both permission prompts and a 60s idle reminder via
                // Notification; both mean the agent is blocked on the human.
                let _ = message;
                self.set(Status::NeedsYou)
            }
            HookEvent::Other(_) => None,
        }
    }

    pub fn on_exit(&mut self) -> Option<Status> {
        let changed = self.status != Status::Exited;
        self.status = Status::Exited;
        changed.then_some(Status::Exited)
    }

    /// Periodic tick — only the heuristic path decays Working → Resting.
    pub fn tick(&mut self, now: Instant) -> Option<Status> {
        if self.hooks || self.status != Status::Working {
            return None;
        }
        match self.last_output {
            Some(t) if now.duration_since(t) >= self.tuning.quiet => self.set(Status::Resting),
            _ => None,
        }
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
        assert_eq!(s.on_output(t0), Some(Status::Resting)); // banner
        assert_eq!(s.on_output(t0 + ms(10)), None); // no input yet → still resting
        s.on_input(t0 + ms(100));
        assert_eq!(s.on_output(t0 + ms(150)), Some(Status::Working));
        assert_eq!(s.tick(t0 + ms(1000)), None);
        assert_eq!(s.tick(t0 + ms(150) + ms(2500)), Some(Status::Resting));
    }

    #[test]
    fn resize_redraw_is_not_work() {
        let t0 = Instant::now();
        let mut s = StatusTracker::new(false, Tuning::default());
        s.on_output(t0);
        s.on_input(t0);
        s.on_resize(t0 + ms(10));
        assert_eq!(s.on_output(t0 + ms(50)), None);
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
        // heuristics are ignored when hooks are on
        assert_eq!(s.tick(t0 + Duration::from_secs(60)), None);
        let n = HookEvent::Notification {
            message: "Claude needs your permission".into(),
        };
        assert_eq!(s.on_hook(&n), Some(Status::NeedsYou));
        assert_eq!(s.on_input(t0), Some(Status::Working));
        assert_eq!(s.on_hook(&HookEvent::Stop), Some(Status::Resting));
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
        let v = serde_json::json!({"hook_event_name": "Notification", "message": "hi"});
        assert_eq!(
            HookEvent::parse(&v),
            HookEvent::Notification {
                message: "hi".into()
            }
        );
        let v = serde_json::json!({"hook_event_name": "SubagentStop"});
        assert_eq!(HookEvent::parse(&v), HookEvent::Stop);
    }
}

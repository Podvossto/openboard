//! PTY session manager (ConPTY on Windows via portable-pty, openpty elsewhere).
//!
//! Each session owns: the master (resize), a writer (input), a reader thread
//! (output → [`PtyEvents::output`] + scrollback + status) and a waiter thread (exit).

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::scrollback::Scrollback;
use crate::status::{HookEvent, Status, StatusTracker, Tuning};
use crate::{Error, Result};

const SCROLLBACK_BYTES: usize = 512 * 1024;
const DSR: &[u8] = b"\x1b[6n";
const CURSOR_REPLY: &[u8] = b"\x1b[1;1R";

/// Remove the first cursor-position query from `chunk`, if present.
fn strip_dsr(chunk: &[u8]) -> Option<Vec<u8>> {
    let at = chunk.windows(DSR.len()).position(|w| w == DSR)?;
    let mut out = Vec::with_capacity(chunk.len() - DSR.len());
    out.extend_from_slice(&chunk[..at]);
    out.extend_from_slice(&chunk[at + DSR.len()..]);
    Some(out)
}

/// Sink for session events — implemented by the Tauri layer (emits to the webview).
pub trait PtyEvents: Send + Sync + 'static {
    fn output(&self, id: &str, data: &[u8]);
    fn status(&self, id: &str, status: Status);
    fn exited(&self, id: &str, code: Option<u32>);
}

pub struct SpawnRequest {
    pub id: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    pub hooks: bool,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    tracker: Arc<Mutex<StatusTracker>>,
    scrollback: Arc<Mutex<Scrollback>>,
}

pub struct PtyManager<E: PtyEvents> {
    sessions: Mutex<HashMap<String, Session>>,
    events: Arc<E>,
}

impl<E: PtyEvents> PtyManager<E> {
    pub fn new(events: Arc<E>) -> Arc<Self> {
        let me = Arc::new(Self {
            sessions: Mutex::default(),
            events,
        });
        // Status decay ticker (heuristic consoles only).
        let weak = Arc::downgrade(&me);
        std::thread::Builder::new()
            .name("pty-status-tick".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(500));
                let Some(m) = weak.upgrade() else { break };
                let now = Instant::now();
                let changes: Vec<(String, Status)> = m
                    .sessions
                    .lock()
                    .iter()
                    .filter_map(|(id, s)| s.tracker.lock().tick(now).map(|st| (id.clone(), st)))
                    .collect();
                for (id, st) in changes {
                    m.events.status(&id, st);
                }
            })
            .expect("spawn ticker");
        me
    }

    pub fn events(&self) -> &E {
        &self.events
    }

    pub fn spawn(self: &Arc<Self>, req: SpawnRequest) -> Result<()> {
        if self.sessions.lock().contains_key(&req.id) {
            return Ok(()); // idempotent: webview reloads re-attach instead of respawning
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: req.rows.max(1),
                cols: req.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(e.to_string()))?;
        let mut cmd = CommandBuilder::new(&req.program);
        cmd.args(&req.args);
        cmd.cwd(&req.cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (k, v) in &req.env {
            cmd.env(k, v);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::Pty(e.to_string()))?;
        drop(pair.slave); // Unix: reader sees EOF once the child exits
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| Error::Pty(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| Error::Pty(e.to_string()))?;

        let tracker = Arc::new(Mutex::new(StatusTracker::new(req.hooks, Tuning::default())));
        let scrollback = Arc::new(Mutex::new(Scrollback::new(SCROLLBACK_BYTES)));
        let killer = child.clone_killer();
        let pid = child.process_id();
        self.sessions.lock().insert(
            req.id.clone(),
            Session {
                master: pair.master,
                writer,
                killer,
                tracker: tracker.clone(),
                scrollback: scrollback.clone(),
            },
        );
        tracing::info!(id = %req.id, ?pid, program = %req.program.display(), "pty spawned");

        // Waiter: owns the child. On exit it removes the session and drops the master —
        // on Windows that closes the ConPTY, which is what unblocks the reader (ConPTY
        // never delivers EOF on its own while the pseudo console is open).
        let (code_tx, code_rx) = std::sync::mpsc::channel::<Option<u32>>();
        let me = Arc::clone(self);
        let id = req.id.clone();
        std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let code = child.wait().ok().map(|st| st.exit_code());
                let session = me.sessions.lock().remove(&id);
                drop(session); // outside the map lock: ClosePseudoConsole may block briefly
                let _ = code_tx.send(code);
            })?;

        // Reader: streams output until EOF, then reports the exit.
        let me = Arc::clone(self);
        let id = req.id.clone();
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 16 * 1024];
                let mut startup_dsr_pending = true;
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let mut chunk = Cow::Borrowed(&buf[..n]);
                            if startup_dsr_pending {
                                // ConPTY (created with INHERIT_CURSOR) asks for the cursor
                                // position and renders nothing until answered. Answer it here
                                // and strip it, so scrollback replays never re-trigger replies.
                                if let Some(stripped) = strip_dsr(&chunk) {
                                    startup_dsr_pending = false;
                                    let _ = me.write_raw(&id, CURSOR_REPLY);
                                    chunk = Cow::Owned(stripped);
                                } else if !cfg!(windows) {
                                    startup_dsr_pending = false;
                                }
                            }
                            let chunk: &[u8] = &chunk;
                            if chunk.is_empty() {
                                continue;
                            }
                            {
                                // Push + emit under one lock so `attach` never drops or
                                // duplicates bytes between its snapshot and live stream.
                                let mut sb = scrollback.lock();
                                sb.push(chunk);
                                me.events.output(&id, chunk);
                            }
                            if let Some(st) = tracker.lock().on_output(Instant::now(), chunk) {
                                me.events.status(&id, st);
                            }
                        }
                    }
                }
                let code = code_rx.recv_timeout(Duration::from_secs(10)).ok().flatten();
                // Unix can hit EOF before the waiter removed the session.
                let session = me.sessions.lock().remove(&id);
                drop(session);
                tracker.lock().on_exit();
                me.events.status(&id, Status::Exited);
                me.events.exited(&id, code);
                tracing::info!(%id, ?code, "pty exited");
            })?;
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let mut map = self.sessions.lock();
        let s = map
            .get_mut(id)
            .ok_or_else(|| Error::ConsoleNotFound(id.into()))?;
        s.writer.write_all(data)?;
        s.writer.flush()?;
        if let Some(st) = s.tracker.lock().on_input(Instant::now()) {
            self.events.status(id, st);
        }
        Ok(())
    }

    /// Write without counting as user input (protocol replies).
    fn write_raw(&self, id: &str, data: &[u8]) -> Result<()> {
        let mut map = self.sessions.lock();
        let s = map
            .get_mut(id)
            .ok_or_else(|| Error::ConsoleNotFound(id.into()))?;
        s.writer.write_all(data)?;
        s.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let map = self.sessions.lock();
        let s = map
            .get(id)
            .ok_or_else(|| Error::ConsoleNotFound(id.into()))?;
        s.tracker.lock().on_resize(Instant::now());
        s.master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| Error::Pty(e.to_string()))
    }

    pub fn hook(&self, id: &str, ev: &HookEvent) {
        let map = self.sessions.lock();
        if let Some(s) = map.get(id) {
            if let Some(st) = s.tracker.lock().on_hook(ev) {
                self.events.status(id, st);
            }
        }
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let mut map = self.sessions.lock();
        let s = map
            .get_mut(id)
            .ok_or_else(|| Error::ConsoleNotFound(id.into()))?;
        let res = s.killer.kill();
        // portable-pty 0.9 `WinChildKiller::kill` inverts TerminateProcess's result and
        // reports Err on success. Exit is confirmed by the waiter thread instead.
        if cfg!(windows) {
            if let Err(e) = res {
                tracing::debug!(%id, %e, "ignoring Windows kill result (upstream bug)");
            }
            return Ok(());
        }
        res?;
        Ok(())
    }

    pub fn kill_all(&self) {
        for s in self.sessions.lock().values_mut() {
            let _ = s.killer.kill();
        }
    }

    /// Run `f` with the current scrollback while output is paused, so the caller can
    /// register a live subscriber with no gap/duplication. `None` if not running.
    pub fn attach<R>(&self, id: &str, f: impl FnOnce(&[u8]) -> R) -> Option<R> {
        let sb = self.sessions.lock().get(id).map(|s| s.scrollback.clone())?;
        let guard = sb.lock();
        Some(f(&guard.snapshot()))
    }

    /// Plain-text tail of the console (ANSI stripped) — for handoff briefs.
    pub fn transcript(&self, id: &str, max_chars: usize) -> Option<String> {
        let raw = self.scrollback(id)?;
        let text = crate::ansi::strip(&raw);
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim_end)
            .filter(|l| !l.is_empty())
            .collect();
        let mut out = lines.join("\n");
        if out.len() > max_chars {
            let mut cut = out.len() - max_chars;
            while !out.is_char_boundary(cut) {
                cut += 1;
            }
            out = out[cut..].to_string();
        }
        Some(out)
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.sessions.lock().keys().cloned().collect()
    }

    pub fn scrollback(&self, id: &str) -> Option<Vec<u8>> {
        self.sessions
            .lock()
            .get(id)
            .map(|s| s.scrollback.lock().snapshot())
    }

    pub fn status(&self, id: &str) -> Option<Status> {
        self.sessions
            .lock()
            .get(id)
            .map(|s| s.tracker.lock().status())
    }

    pub fn is_running(&self, id: &str) -> bool {
        self.sessions.lock().contains_key(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_first_dsr_only() {
        assert_eq!(strip_dsr(b"a\x1b[6nb\x1b[6n").unwrap(), b"ab\x1b[6n");
        assert_eq!(strip_dsr(b"\x1b[6n").unwrap(), b"");
        assert!(strip_dsr(b"plain").is_none());
    }
}

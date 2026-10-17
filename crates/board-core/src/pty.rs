//! PTY session manager (ConPTY on Windows via portable-pty, openpty elsewhere).
//!
//! Each session owns: the master (resize), a writer (input), a reader thread
//! (output → [`PtyEvents::output`] + scrollback + status) and a waiter thread (exit).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::scrollback::Scrollback;
use crate::status::{HookEvent, Status, StatusTracker, Tuning};
use crate::{Error, Result};

const SCROLLBACK_BYTES: usize = 512 * 1024;

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
    child: Box<dyn Child + Send + Sync>,
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
                rows: req.rows,
                cols: req.cols,
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
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| Error::Pty(e.to_string()))?;
        drop(pair.slave); // so reader sees EOF when the child exits
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
        let mut killer = child.clone_killer();
        let pid = child.process_id();
        self.sessions.lock().insert(
            req.id.clone(),
            Session {
                master: pair.master,
                writer,
                child,
                tracker: tracker.clone(),
                scrollback: scrollback.clone(),
            },
        );
        tracing::info!(id = %req.id, ?pid, program = %req.program.display(), "pty spawned");

        let me = Arc::clone(self);
        let id = req.id.clone();
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut reader = reader;
                let mut buf = [0u8; 16 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let chunk = &buf[..n];
                            {
                                // Push + emit under one lock so `attach` never drops or
                                // duplicates bytes between its snapshot and live stream.
                                let mut sb = scrollback.lock();
                                sb.push(chunk);
                                me.events.output(&id, chunk);
                            }
                            if let Some(st) = tracker.lock().on_output(Instant::now()) {
                                me.events.status(&id, st);
                            }
                        }
                    }
                }
                me.reap(&id);
            })
            .map_err(Error::Io)
            .inspect_err(|_| {
                let _ = killer.kill();
            })?;
        Ok(())
    }

    /// Called when output hits EOF: collect exit code and drop the session.
    fn reap(&self, id: &str) {
        let Some(mut s) = self.sessions.lock().remove(id) else {
            return;
        };
        let code = s.child.wait().ok().map(|st| st.exit_code());
        s.tracker.lock().on_exit();
        self.events.status(id, Status::Exited);
        self.events.exited(id, code);
        tracing::info!(%id, ?code, "pty exited");
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
        s.child.kill()?;
        Ok(())
    }

    pub fn kill_all(&self) {
        for s in self.sessions.lock().values_mut() {
            let _ = s.child.kill();
        }
    }

    /// Run `f` with the current scrollback while output is paused, so the caller can
    /// register a live subscriber with no gap/duplication. `None` if not running.
    pub fn attach<R>(&self, id: &str, f: impl FnOnce(&[u8]) -> R) -> Option<R> {
        let sb = self.sessions.lock().get(id).map(|s| s.scrollback.clone())?;
        let guard = sb.lock();
        Some(f(&guard.snapshot()))
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

use std::collections::HashMap;

use board_core::pty::PtyEvents;
use board_core::status::Status;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

/// Bridges PTY events to the webview.
/// - Terminal bytes go over per-console `Channel`s (binary, ordered, fast).
/// - Status/exit go out as global events so the board, not just the terminal, sees them.
pub struct TauriEvents {
    app: AppHandle,
    channels: Mutex<HashMap<String, Channel<InvokeResponseBody>>>,
}

#[derive(Serialize, Clone)]
struct StatusPayload<'a> {
    id: &'a str,
    status: Status,
}

#[derive(Serialize, Clone)]
struct ExitPayload<'a> {
    id: &'a str,
    code: Option<u32>,
}

impl TauriEvents {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            channels: Mutex::default(),
        }
    }

    pub fn subscribe(&self, id: &str, ch: Channel<InvokeResponseBody>) {
        self.channels.lock().insert(id.to_string(), ch);
    }
}

impl PtyEvents for TauriEvents {
    fn output(&self, id: &str, data: &[u8]) {
        let mut chans = self.channels.lock();
        if let Some(ch) = chans.get(id) {
            if ch.send(InvokeResponseBody::Raw(data.to_vec())).is_err() {
                chans.remove(id); // webview went away; reattach will resubscribe
            }
        }
    }

    fn status(&self, id: &str, status: Status) {
        let _ = self
            .app
            .emit("console://status", StatusPayload { id, status });
    }

    fn exited(&self, id: &str, code: Option<u32>) {
        self.channels.lock().remove(id);
        let _ = self.app.emit("console://exit", ExitPayload { id, code });
    }
}

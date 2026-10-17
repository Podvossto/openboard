use std::path::PathBuf;
use std::sync::Arc;

use board_core::hooks::HookServer;
use board_core::persist::Store;
use board_core::pty::PtyManager;
use parking_lot::Mutex;

use crate::events::TauriEvents;

pub struct AppState {
    pub store: Mutex<Store>,
    pub pty: Arc<PtyManager<TauriEvents>>,
    pub hooks: HookServer,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(
        store: Store,
        pty: Arc<PtyManager<TauriEvents>>,
        hooks: HookServer,
        data_dir: PathBuf,
    ) -> Self {
        Self {
            store: Mutex::new(store),
            pty,
            hooks,
            data_dir,
        }
    }

    pub fn events(&self) -> &TauriEvents {
        self.pty.events()
    }
}

use std::path::PathBuf;
use std::sync::Arc;

use board_core::hooks::HookServer;
use board_core::persist::Store;
use board_core::pty::PtyManager;
use board_core::settings::{Settings, SettingsStore};
use parking_lot::Mutex;

use crate::events::TauriEvents;

pub struct AppState {
    pub store: Mutex<Store>,
    pub settings_store: SettingsStore,
    pub settings: Mutex<Settings>,
    pub pty: Arc<PtyManager<TauriEvents>>,
    pub hooks: HookServer,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn events(&self) -> &TauriEvents {
        self.pty.events()
    }
}

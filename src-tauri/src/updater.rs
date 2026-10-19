//! In-app updates (tauri-plugin-updater). The endpoint + minisign public key live in
//! tauri.conf.json (`plugins.updater`); every download is signature-checked before install.
//! The UI always asks first: `update_check` only looks, `update_install` downloads + installs.

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use board_core::{Error, Result};

/// The update found by the last check, kept so install uses exactly what the user saw.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn err(e: impl std::fmt::Display) -> Error {
    Error::Browser(format!("update: {e}"))
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// `None` = up to date.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>> {
    let update = app.updater().map_err(err)?.check().await.map_err(err)?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock() = update;
    Ok(info)
}

/// Download (emits `updater://progress`), verify, install, then restart into the new version.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<()> {
    let update = pending
        .0
        .lock()
        .take()
        .ok_or_else(|| err("no update pending — check again"))?;
    let mut downloaded = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("updater://progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(err)?;
    // stop running agents cleanly before the process is replaced
    app.state::<crate::state::AppState>().pty.kill_all();
    app.restart();
}

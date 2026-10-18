mod commands;
mod events;
mod state;

use std::sync::Arc;

use board_core::hooks::HookServer;
use board_core::persist::Store;
use board_core::pty::PtyManager;
use board_core::settings::SettingsStore;
use parking_lot::Mutex;
use tauri::{Emitter, Manager};

use crate::events::TauriEvents;
use crate::state::AppState;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,agent_board=debug,board_core=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let store = Store::new(&data_dir)?;
            let settings_store = SettingsStore::new(&data_dir)?;
            let settings = settings_store.load();
            let events = Arc::new(TauriEvents::new(handle.clone()));
            let pty = PtyManager::new(events);

            let pty_for_hooks = pty.clone();
            let hook_handle = handle.clone();
            let hooks = tauri::async_runtime::block_on(HookServer::start(Arc::new(
                move |console, ev, session| {
                    pty_for_hooks.hook(&console, &ev);
                    // Hook log for the console "…" → Diagnostics panel.
                    let _ = hook_handle.emit(
                        "console://hook",
                        serde_json::json!({ "id": console, "event": ev.name(), "session": session }),
                    );
                },
            )))?;

            app.manage(AppState {
                store: Mutex::new(store),
                settings_store,
                settings: Mutex::new(settings),
                pty,
                hooks,
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_board,
            commands::save_board,
            commands::load_settings,
            commands::save_settings,
            commands::new_id,
            commands::spawn_console,
            commands::attach_console,
            commands::write_console,
            commands::resize_console,
            commands::kill_console,
            commands::console_status,
            commands::console_transcript,
            commands::detect_agents,
            commands::claude_usage,
            commands::handoff_brief,
            commands::route_instruction,
            commands::git_status,
            commands::git_run,
            commands::loop_goal_check,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Agent Board")
        .run(|app, ev| {
            if let tauri::RunEvent::Exit = ev {
                app.state::<AppState>().pty.kill_all();
            }
        });
}

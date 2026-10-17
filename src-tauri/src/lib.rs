mod commands;
mod events;
mod state;

use std::sync::Arc;

use board_core::hooks::HookServer;
use board_core::persist::Store;
use board_core::pty::PtyManager;
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
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let store = Store::new(&data_dir)?;
            let events = Arc::new(TauriEvents::new(handle.clone()));
            let pty = PtyManager::new(events);

            let pty_for_hooks = pty.clone();
            let hook_handle = handle.clone();
            let hooks = tauri::async_runtime::block_on(HookServer::start(Arc::new(
                move |console, ev, session| {
                    pty_for_hooks.hook(&console, &ev);
                    if let Some(session) = session {
                        let _ = hook_handle.emit(
                            "console://session",
                            serde_json::json!({ "id": console, "session": session }),
                        );
                    }
                },
            )))?;

            app.manage(AppState::new(store, pty, hooks, data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_workspace,
            commands::save_workspace,
            commands::new_console_id,
            commands::spawn_console,
            commands::attach_console,
            commands::write_console,
            commands::resize_console,
            commands::kill_console,
            commands::console_status,
            commands::detect_agents,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Agent Board")
        .run(|app, ev| {
            if let tauri::RunEvent::Exit = ev {
                app.state::<AppState>().pty.kill_all();
            }
        });
}

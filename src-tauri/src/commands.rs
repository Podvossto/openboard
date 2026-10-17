//! IPC surface. Thin: validate → delegate to board-core.

use std::path::PathBuf;

use board_core::agents::{self, launch_spec, Mode};
use board_core::hooks::{claude_settings, hook_command};
use board_core::model::{AgentKind, Workspace};
use board_core::pty::SpawnRequest;
use board_core::status::Status;
use board_core::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedWorkspace {
    workspace: Workspace,
    /// Non-null when the main file was corrupt and a backup was used.
    recovered_from_backup: Option<usize>,
}

#[tauri::command]
pub fn load_workspace(state: State<'_, AppState>) -> Result<LoadedWorkspace> {
    use board_core::persist::LoadOutcome;
    let (workspace, outcome) = state.store.lock().load()?;
    let recovered_from_backup = match outcome {
        LoadOutcome::RecoveredFromBackup(n) => Some(n),
        LoadOutcome::Fresh | LoadOutcome::Loaded => None,
    };
    Ok(LoadedWorkspace {
        workspace,
        recovered_from_backup,
    })
}

#[tauri::command]
pub fn save_workspace(state: State<'_, AppState>, workspace: Workspace) -> Result<()> {
    state.store.lock().save(&workspace)
}

#[tauri::command]
pub fn new_console_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    id: String,
    agent: AgentKind,
    cwd: String,
    cols: u16,
    rows: u16,
    /// Claude: pre-assigned (fresh) or stored (resume) session id.
    agent_session: Option<String>,
    resume: bool,
}

#[tauri::command]
pub fn spawn_console(state: State<'_, AppState>, args: SpawnArgs) -> Result<()> {
    let cwd = PathBuf::from(&args.cwd);
    if !cwd.is_dir() {
        return Err(Error::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("working directory does not exist: {}", args.cwd),
        )));
    }
    let settings = if args.agent.supports_hooks() {
        Some(write_claude_settings(&state)?)
    } else {
        None
    };
    let session = args.agent_session.as_deref();
    let mode = if args.resume {
        Mode::Resume { session }
    } else {
        Mode::Fresh { session }
    };
    let spec = launch_spec(&args.agent, mode, settings.as_deref());
    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
    let (program, argv) = agents::wrap_batch(agents::resolve(&spec.program)?, spec.args, &comspec);
    state.pty.spawn(SpawnRequest {
        env: state.hooks.env_for(&args.id),
        id: args.id,
        program,
        args: argv,
        cwd,
        cols: args.cols,
        rows: args.rows,
        hooks: args.agent.supports_hooks(),
    })
}

/// One shared settings file (hooks read console id from env, so it is console-agnostic).
fn write_claude_settings(state: &AppState) -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let path = state.data_dir.join("claude-hooks.settings.json");
    let doc = claude_settings(&hook_command(&exe));
    std::fs::write(&path, serde_json::to_vec_pretty(&doc)?)?;
    Ok(path)
}

/// Subscribe a terminal view: replays scrollback then streams live bytes, gap-free.
/// Returns false if the console is not running (UI shows "start/resume").
#[tauri::command]
pub fn attach_console(
    state: State<'_, AppState>,
    id: String,
    on_data: Channel<InvokeResponseBody>,
) -> bool {
    state
        .pty
        .attach(&id, |snapshot| {
            if !snapshot.is_empty() {
                let _ = on_data.send(InvokeResponseBody::Raw(snapshot.to_vec()));
            }
            state.events().subscribe(&id, on_data.clone());
        })
        .is_some()
}

#[tauri::command]
pub fn write_console(state: State<'_, AppState>, id: String, data: String) -> Result<()> {
    state.pty.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn resize_console(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<()> {
    state.pty.resize(&id, cols, rows)
}

#[tauri::command]
pub fn kill_console(state: State<'_, AppState>, id: String) -> Result<()> {
    state.pty.kill(&id)
}

#[tauri::command]
pub fn console_status(state: State<'_, AppState>, id: String) -> Option<Status> {
    state.pty.status(&id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    claude: bool,
    codex: bool,
    shell: String,
}

#[tauri::command]
pub fn detect_agents() -> Detected {
    Detected {
        claude: agents::resolve("claude").is_ok(),
        codex: agents::resolve("codex").is_ok(),
        shell: agents::default_shell(),
    }
}

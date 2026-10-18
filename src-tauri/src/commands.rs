//! IPC surface. Thin: validate → delegate to board-core.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use board_core::agents::{self, launch_spec, AuthInfo, LaunchSpec, Mode};
use board_core::hooks::{claude_settings, hook_command};
use board_core::model::{AgentKind, Board};
use board_core::pty::SpawnRequest;
use board_core::settings::{home_dir, Settings};
use board_core::status::Status;
use board_core::usage::{self, Usage};
use board_core::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::state::AppState;

// ---------- board + settings ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedBoard {
    board: Board,
    /// Non-null when the main file was corrupt and a backup was used.
    recovered_from_backup: Option<usize>,
}

#[tauri::command]
pub fn load_board(state: State<'_, AppState>) -> Result<LoadedBoard> {
    use board_core::persist::LoadOutcome;
    let (board, outcome) = state.store.lock().load()?;
    let recovered_from_backup = match outcome {
        LoadOutcome::RecoveredFromBackup(n) => Some(n),
        LoadOutcome::Fresh | LoadOutcome::Loaded => None,
    };
    Ok(LoadedBoard {
        board,
        recovered_from_backup,
    })
}

#[tauri::command]
pub fn save_board(state: State<'_, AppState>, board: Board) -> Result<()> {
    state.store.lock().save(&board)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettings {
    settings: Settings,
    /// What an empty `defaultCwd` resolves to (for display).
    resolved_cwd: String,
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> LoadedSettings {
    let settings = state.settings.lock().clone();
    LoadedSettings {
        resolved_cwd: settings.resolved_cwd().display().to_string(),
        settings,
    }
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<LoadedSettings> {
    state.settings_store.save(&settings)?;
    *state.settings.lock() = settings.clone();
    Ok(LoadedSettings {
        resolved_cwd: settings.resolved_cwd().display().to_string(),
        settings,
    })
}

#[tauri::command]
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------- consoles ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    id: String,
    agent: AgentKind,
    /// Empty → settings default.
    cwd: String,
    cols: u16,
    rows: u16,
    /// Claude: pre-assigned (fresh) or stored (resume) session id.
    agent_session: Option<String>,
    resume: bool,
    /// Run the CLI's login flow instead of the agent.
    #[serde(default)]
    login: bool,
}

#[tauri::command]
pub fn spawn_console(state: State<'_, AppState>, args: SpawnArgs) -> Result<()> {
    let settings = state.settings.lock().clone();
    let cwd = if args.cwd.trim().is_empty() {
        settings.resolved_cwd()
    } else {
        PathBuf::from(&args.cwd)
    };
    if !cwd.is_dir() {
        return Err(Error::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("working directory does not exist: {}", cwd.display()),
        )));
    }
    let agent = match &args.agent {
        AgentKind::Custom { program, args } if program.trim().is_empty() => AgentKind::Custom {
            program: if settings.shell.trim().is_empty() {
                agents::default_shell()
            } else {
                settings.shell.clone()
            },
            args: args.clone(),
        },
        a => a.clone(),
    };
    let hooks = agent.supports_hooks() && !args.login;
    let spec = if args.login {
        agents::login_spec(&agent)
            .ok_or_else(|| Error::Pty("this console type has no login flow".into()))?
    } else {
        let settings_file = if hooks {
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
        let mut spec = launch_spec(&agent, mode, settings_file.as_deref());
        match agent {
            AgentKind::ClaudeCode => spec.args.extend(settings.claude_args.iter().cloned()),
            AgentKind::Codex => spec.args.extend(settings.codex_args.iter().cloned()),
            AgentKind::Custom { .. } => {}
        }
        spec
    };
    let (program, argv) = resolve_spec(spec)?;
    state.pty.spawn(SpawnRequest {
        env: state.hooks.env_for(&args.id),
        id: args.id,
        program,
        args: argv,
        cwd,
        cols: args.cols,
        rows: args.rows,
        hooks,
    })
}

fn resolve_spec(spec: LaunchSpec) -> Result<(PathBuf, Vec<String>)> {
    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
    Ok(agents::wrap_batch(
        agents::resolve(&spec.program)?,
        spec.args,
        &comspec,
    ))
}

/// One shared settings file (hooks read the console id from env, so it is console-agnostic).
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

#[tauri::command]
pub fn console_transcript(state: State<'_, AppState>, id: String) -> Option<String> {
    state.pty.transcript(&id, 12_000)
}

// ---------- agents / accounts ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    claude: AuthInfo,
    codex: AuthInfo,
    shell: String,
}

#[tauri::command]
pub async fn detect_agents(state: State<'_, AppState>) -> Result<Detected> {
    let shell_setting = state.settings.lock().shell.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir().unwrap_or_default();
        Detected {
            claude: agents::auth_info(&AgentKind::ClaudeCode, &home),
            codex: agents::auth_info(&AgentKind::Codex, &home),
            shell: if shell_setting.trim().is_empty() {
                agents::default_shell()
            } else {
                shell_setting
            },
        }
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))
}

#[tauri::command]
pub async fn claude_usage() -> Usage {
    tauri::async_runtime::spawn_blocking(|| usage::fetch_claude(&home_dir().unwrap_or_default()))
        .await
        .unwrap_or_default()
}

/// Run `claude -p` (the user's own subscription) with `prompt` on stdin; return stdout.
fn claude_print(cwd: std::path::PathBuf, prompt: String, extra: &[&str]) -> Result<String> {
    let mut a = vec!["-p".to_string()];
    a.extend(extra.iter().map(|s| s.to_string()));
    let (program, args) = resolve_spec(LaunchSpec {
        program: "claude".into(),
        args: a,
    })?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn()?;
    child
        .stdin
        .take()
        .expect("piped")
        .write_all(prompt.as_bytes())?;
    let out = child.wait_with_output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(Error::Pty(format!("claude -p failed: {}", err.trim())));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Summarise console `from` with `claude -p` and return the brief.
#[tauri::command]
pub async fn handoff_brief(
    state: State<'_, AppState>,
    from: String,
    from_title: String,
    to_title: String,
) -> Result<String> {
    let transcript = state
        .pty
        .transcript(&from, 12_000)
        .ok_or_else(|| Error::ConsoleNotFound(from.clone()))?;
    let cwd = state.settings.lock().resolved_cwd();
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = agents::handoff_prompt(&from_title, &to_title, &transcript);
        claude_print(cwd, prompt, &[])
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))?
}

/// AI dispatcher: turn a free-form instruction into a send/handoff plan (`claude -p`).
#[tauri::command]
pub async fn route_instruction(
    state: State<'_, AppState>,
    instruction: String,
    consoles: Vec<board_core::router::RouterConsole>,
) -> Result<board_core::router::Plan> {
    let cwd = state.settings.lock().resolved_cwd();
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = board_core::router::router_prompt(&instruction, &consoles);
        // routing is a small classification job — the fast model is plenty
        let raw = claude_print(cwd, prompt, &["--model", "haiku"])?;
        board_core::router::parse_plan(&raw, &consoles)
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))?
}

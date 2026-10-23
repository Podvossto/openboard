//! IPC surface. Thin: validate → delegate to board-core.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use board_core::agents::{self, launch_spec, AuthInfo, LaunchSpec, Mode};
use board_core::hooks::{claude_settings, hook_command};
use board_core::model::{AgentKind, Board};
use board_core::profiles::{self, Profile};
use board_core::pty::SpawnRequest;
use board_core::settings::{home_dir, Settings};
use board_core::status::Status;
use board_core::usage::{self, Usage};
use board_core::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

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
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
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
    /// Profile id (account / provider) — None = the CLI's default login.
    #[serde(default)]
    profile: Option<String>,
    /// Orchestrator lead: gets the openboard MCP tools + lead instructions (Claude only).
    #[serde(default)]
    lead: bool,
    /// Per-console model override (`--model`), e.g. "opus" / "sonnet" for Claude.
    #[serde(default)]
    model: Option<String>,
    /// Linked tiles (kind, title) — the agent gets the matching tile tools.
    #[serde(default)]
    links: Vec<(String, String)>,
    /// Extra system prompt (workspace memory, preset role + focus skills) — Claude only.
    #[serde(default)]
    extra_prompt: String,
    /// Extra MCP servers from the console's agent preset — Claude only.
    #[serde(default)]
    extra_mcp: Vec<board_core::settings::PresetMcp>,
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
    let profile = match args.profile.as_deref().filter(|p| !p.is_empty()) {
        Some(pid) => {
            let p = settings
                .profiles
                .iter()
                .find(|p| p.id == pid)
                .cloned()
                .ok_or_else(|| Error::Pty(format!("profile {pid} no longer exists")))?;
            if !profiles::compatible(&p, &agent) {
                return Err(Error::Pty(format!(
                    "profile \"{}\" is not for this CLI",
                    p.name
                )));
            }
            Some(p)
        }
        None => None,
    };
    let mut env = state.hooks.env_for(&args.id);
    if let Some(p) = &profile {
        let key = if profiles::needs_key(p) {
            Some(state.keys.get(&p.id).ok_or_else(|| {
                Error::Pty(format!(
                    "no API key saved for \"{}\" — add it in Settings → Accounts",
                    p.name
                ))
            })?)
        } else {
            None
        };
        let dir = profiles::config_dir(&state.data_dir, p);
        std::fs::create_dir_all(&dir)?;
        env.extend(profiles::env_for(p, &state.data_dir, key.as_deref()));
    }
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
        let kinds: Vec<String> = args.links.iter().map(|l| l.0.clone()).collect();
        let tiles_prompt = board_core::mcp::tiles_prompt(&args.links);
        if matches!(agent, AgentKind::ClaudeCode) {
            let board_tools = args.lead || !args.links.is_empty();
            let mut servers = board_core::mcp::preset_mcp_servers(&args.extra_mcp);
            if board_tools {
                let cfg = board_core::mcp::claude_mcp_config(
                    &state.hooks.url(),
                    &state.hooks.token,
                    &args.id,
                );
                if let Some(m) = cfg.get("mcpServers").and_then(|v| v.as_object()) {
                    servers.extend(m.clone());
                }
            }
            if !servers.is_empty() {
                let path = state.data_dir.join(format!("mcp-{}.json", args.id));
                std::fs::write(
                    &path,
                    serde_json::to_vec(&serde_json::json!({ "mcpServers": servers }))?,
                )?;
                spec.args
                    .extend(["--mcp-config".into(), path.display().to_string()]);
            }
            if board_tools {
                spec.args.extend([
                    "--allowedTools".into(),
                    board_core::mcp::allowed_tools(args.lead, &kinds),
                ]);
            }
            let prompt = board_core::mcp::join_prompts(&[
                if args.lead {
                    board_core::mcp::LEAD_PROMPT
                } else {
                    ""
                },
                tiles_prompt.as_str(),
                args.extra_prompt.as_str(),
            ]);
            if !prompt.is_empty() {
                spec.args.extend(["--append-system-prompt".into(), prompt]);
            }
        }
        match agent {
            AgentKind::ClaudeCode => spec.args.extend(settings.claude_args.iter().cloned()),
            AgentKind::Codex => spec.args.extend(settings.codex_args.iter().cloned()),
            AgentKind::Custom { .. } => {}
        }
        // after the defaults so the per-console choice wins (CLIs take the last --model)
        spec.args
            .extend(agents::model_args(&agent, args.model.as_deref()));
        spec
    };
    let (program, argv) = resolve_spec(spec)?;
    state.pty.spawn(SpawnRequest {
        env,
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
    /// Other agent CLIs (gemini, opencode, aider …) and whether they are on PATH.
    catalog: Vec<board_core::catalog::CatalogStatus>,
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
            catalog: board_core::catalog::detect(|p| agents::resolve(p).is_ok()),
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

/// Loop goal check: summarise console output vs. `goal` with `claude -p` (fast model).
#[tauri::command]
pub async fn loop_goal_check(
    state: State<'_, AppState>,
    id: String,
    title: String,
    goal: String,
) -> Result<board_core::router::GoalVerdict> {
    let transcript = state
        .pty
        .transcript(&id, 6_000)
        .ok_or_else(|| Error::ConsoleNotFound(id.clone()))?;
    let cwd = state.settings.lock().resolved_cwd();
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = board_core::router::goal_prompt(&goal, &title, &transcript);
        let raw = claude_print(cwd, prompt, &["--model", "haiku"])?;
        board_core::router::parse_goal(&raw)
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))?
}

// ---------- git card ----------

fn tile_cwd(state: &State<'_, AppState>, cwd: &str) -> PathBuf {
    if cwd.trim().is_empty() {
        state.settings.lock().resolved_cwd()
    } else {
        PathBuf::from(cwd)
    }
}

#[tauri::command]
pub async fn git_status(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<board_core::git::GitStatus> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::status(&dir))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_run(
    state: State<'_, AppState>,
    cwd: String,
    action: board_core::git::GitAction,
    message: String,
) -> Result<String> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::run(&dir, action, &message))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_stage(state: State<'_, AppState>, cwd: String, paths: Vec<String>) -> Result<()> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::stage(&dir, &paths))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_unstage(
    state: State<'_, AppState>,
    cwd: String,
    paths: Vec<String>,
) -> Result<()> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::unstage(&dir, &paths))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

/// Commit the index as-is (the UI stages files itself; nothing is added here).
#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    cwd: String,
    message: String,
) -> Result<String> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::commit(&dir, &message))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<Vec<board_core::git::GitBranch>> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::branches(&dir))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_checkout(state: State<'_, AppState>, cwd: String, branch: String) -> Result<()> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::checkout(&dir, &branch))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    cwd: String,
    name: String,
) -> Result<()> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::create_branch(&dir, &name))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn git_graph(
    state: State<'_, AppState>,
    cwd: String,
    limit: u32,
) -> Result<board_core::git::GitGraph> {
    let dir = tile_cwd(&state, &cwd);
    tauri::async_runtime::spawn_blocking(move || board_core::git::graph(&dir, limit))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

// ---------- code studio (sandboxed file access) ----------

#[tauri::command]
pub async fn fs_list(
    state: State<'_, AppState>,
    root: String,
    rel: String,
) -> Result<Vec<board_core::files::FsEntry>> {
    let dir = tile_cwd(&state, &root);
    tauri::async_runtime::spawn_blocking(move || board_core::files::list_dir(&dir, &rel))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn fs_read(
    state: State<'_, AppState>,
    root: String,
    rel: String,
) -> Result<board_core::files::FileContent> {
    let dir = tile_cwd(&state, &root);
    tauri::async_runtime::spawn_blocking(move || board_core::files::read_file(&dir, &rel))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn fs_write(
    state: State<'_, AppState>,
    root: String,
    rel: String,
    text: String,
) -> Result<()> {
    let dir = tile_cwd(&state, &root);
    tauri::async_runtime::spawn_blocking(move || board_core::files::write_file(&dir, &rel, &text))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

// ---------- profiles / accounts ----------

#[tauri::command]
pub fn provider_presets() -> &'static [profiles::ProviderPreset] {
    profiles::PRESETS
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    id: String,
    has_key: bool,
    /// "abcd…wxyz" — never the key itself
    masked: Option<String>,
}

#[tauri::command]
pub fn profile_key_status(state: State<'_, AppState>) -> Vec<KeyStatus> {
    let ps = state.settings.lock().profiles.clone();
    ps.iter()
        .filter(|p| profiles::needs_key(p))
        .map(|p| {
            let k = state.keys.get(&p.id);
            KeyStatus {
                id: p.id.clone(),
                has_key: k.is_some(),
                masked: k.as_deref().map(profiles::mask),
            }
        })
        .collect()
}

#[tauri::command]
pub fn set_profile_key(state: State<'_, AppState>, id: String, key: String) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(Error::Pty("key is empty".into()));
    }
    state.keys.set(&id, key)
}

#[tauri::command]
pub fn delete_profile_key(state: State<'_, AppState>, id: String) -> Result<()> {
    state.keys.delete(&id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    /// "default-claude" | "default-codex" | profile id
    id: String,
    name: String,
    provider: String,
    usage: Usage,
}

/// Plan usage for every account we can read: default Claude, default Codex, each profile.
#[tauri::command]
pub async fn usage_all(state: State<'_, AppState>) -> Result<Vec<AccountUsage>> {
    let ps: Vec<Profile> = state.settings.lock().profiles.clone();
    let data_dir = state.data_dir.clone();
    let keys: Vec<(String, Option<String>)> = ps
        .iter()
        .map(|p| (p.id.clone(), state.keys.get(&p.id)))
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir().unwrap_or_default();
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".codex"));
        let mut out = vec![
            AccountUsage {
                id: "default-claude".into(),
                name: "Claude (default)".into(),
                provider: "anthropic".into(),
                usage: usage::fetch_claude(&home),
            },
            AccountUsage {
                id: "default-codex".into(),
                name: "Codex (default)".into(),
                provider: "openai".into(),
                usage: usage::fetch_codex(&codex_home),
            },
        ];
        for p in &ps {
            let key = keys
                .iter()
                .find(|(id, _)| id == &p.id)
                .and_then(|(_, k)| k.clone());
            let (provider, u) = match (&p.kind, p.cli) {
                (profiles::ProfileKind::Subscription, profiles::Cli::Claude) => (
                    "anthropic".to_string(),
                    usage::fetch_claude_dir(&profiles::config_dir(&data_dir, p)),
                ),
                (profiles::ProfileKind::Subscription, profiles::Cli::Codex) => (
                    "openai".to_string(),
                    usage::fetch_codex(&profiles::config_dir(&data_dir, p)),
                ),
                (profiles::ProfileKind::Provider { provider, .. }, _) => {
                    let u = match (provider.as_str(), key) {
                        ("zai", Some(k)) => usage::fetch_zai(&k),
                        (_, None) => Usage {
                            error: Some("no API key".into()),
                            ..Default::default()
                        },
                        _ => Usage {
                            error: Some("usage not available for this provider".into()),
                            ..Default::default()
                        },
                    };
                    (provider.clone(), u)
                }
            };
            out.push(AccountUsage {
                id: p.id.clone(),
                name: p.name.clone(),
                provider,
                usage: u,
            });
        }
        out
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))
}

/// Usage analytics from local session logs (Claude projects + Codex rollouts,
/// including every profile's config dir) for the last `days` days.
#[tauri::command]
pub async fn usage_analytics(
    state: State<'_, AppState>,
    days: u32,
) -> Result<board_core::analytics::Analytics> {
    let profiles = state.settings.lock().profiles.clone();
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir().unwrap_or_default();
        let sources = board_core::analytics::default_sources(&home, &data_dir, &profiles);
        board_core::analytics::collect(&sources, days as usize)
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))
}

/// Token usage per Claude session id (per-console usage chips). Unknown ids are omitted.
#[tauri::command]
pub async fn usage_for_sessions(
    state: State<'_, AppState>,
    session_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, board_core::analytics::SessionUsage>> {
    let profiles = state.settings.lock().profiles.clone();
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir().unwrap_or_default();
        let sources = board_core::analytics::default_sources(&home, &data_dir, &profiles);
        board_core::analytics::session_usage(&sources, &session_ids)
    })
    .await
    .map_err(|e| Error::Pty(e.to_string()))
}

// ---------- orchestrator ----------

/// The UI pushes the current consoles (all workspaces) so lead agents can address them.
#[tauri::command]
pub fn sync_roster(state: State<'_, AppState>, roster: Vec<crate::orchestrator::RosterEntry>) {
    *state.tools.roster.lock() = roster;
}

/// The UI applied (or rejected) a `tile://op` from an agent; `error` wins over `text`.
#[tauri::command]
pub fn tile_op_result(
    state: State<'_, AppState>,
    op_id: String,
    text: Option<String>,
    error: Option<String>,
) {
    let r = match error {
        Some(e) => Err(e),
        None => Ok(text.unwrap_or_default()),
    };
    crate::orchestrator::complete_op(&state.tools, &op_id, r);
}

// ---------- skills & MCP (the CLIs own their config) ----------

use board_core::extensions::{self, AddMcp, CliHome, McpServer, Scope, Skill};

fn ext_home(state: &AppState, cli: profiles::Cli, profile: Option<&str>) -> Result<CliHome> {
    let home = home_dir().unwrap_or_default();
    let custom = match profile.filter(|p| !p.is_empty()) {
        Some(pid) => {
            let p = state
                .settings
                .lock()
                .profiles
                .iter()
                .find(|p| p.id == pid)
                .cloned()
                .ok_or_else(|| Error::Pty(format!("profile {pid} no longer exists")))?;
            if p.cli != cli {
                return Err(Error::Pty(format!(
                    "profile \"{}\" is not for this CLI",
                    p.name
                )));
            }
            Some(profiles::config_dir(&state.data_dir, &p))
        }
        None => std::env::var_os(match cli {
            profiles::Cli::Claude => "CLAUDE_CONFIG_DIR",
            profiles::Cli::Codex => "CODEX_HOME",
        })
        .filter(|v| !v.is_empty())
        .map(PathBuf::from),
    };
    Ok(CliHome::resolve(cli, custom, &home))
}

fn project_dir(cwd: &Option<String>) -> Option<PathBuf> {
    cwd.as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

#[tauri::command]
pub fn list_skills(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
) -> Result<Vec<Skill>> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    Ok(extensions::list_skills(&h, project_dir(&cwd).as_deref()))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_skill(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
    scope: Scope,
    name: String,
    description: String,
    body: String,
) -> Result<Skill> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    extensions::create_skill(
        &h,
        scope,
        project_dir(&cwd).as_deref(),
        &name,
        &description,
        &body,
    )
}

#[tauri::command]
pub fn delete_skill(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
    scope: Scope,
    name: String,
) -> Result<()> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    extensions::delete_skill(&h, scope, project_dir(&cwd).as_deref(), &name)
}

#[tauri::command]
pub fn list_mcp(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
) -> Result<Vec<McpServer>> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    Ok(extensions::list_mcp(&h, project_dir(&cwd).as_deref()))
}

fn drain<R: std::io::Read + Send + 'static>(r: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(mut r) = r {
            let _ = r.read_to_end(&mut b);
        }
        String::from_utf8_lossy(&b).into_owned()
    })
}

/// Run `<cli> <args>` (30 s cap) in `dir` with the account's config dir; Err carries stderr.
fn run_cli(
    cli: profiles::Cli,
    home: &CliHome,
    dir: Option<PathBuf>,
    args: Vec<String>,
) -> Result<String> {
    let (program, args) = resolve_spec(LaunchSpec {
        program: match cli {
            profiles::Cli::Claude => "claude",
            profiles::Cli::Codex => "codex",
        }
        .into(),
        args,
    })?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    cmd.env(
        match cli {
            profiles::Cli::Claude => "CLAUDE_CONFIG_DIR",
            profiles::Cli::Codex => "CODEX_HOME",
        },
        &home.dir,
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn()?;
    let out = drain(child.stdout.take());
    let err = drain(child.stderr.take());
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break st;
        }
        if started.elapsed() > std::time::Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Pty("CLI timed out after 30 s".into()));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let (out, err) = (
        out.join().unwrap_or_default(),
        err.join().unwrap_or_default(),
    );
    if status.success() {
        Ok(out.trim().to_string())
    } else {
        let msg = if err.trim().is_empty() { out } else { err };
        Err(Error::Pty(msg.trim().to_string()))
    }
}

/// Project-scoped changes run inside the project folder (the CLI writes `.mcp.json` there).
fn mcp_dir(scope: Scope, cwd: &Option<String>) -> Result<Option<PathBuf>> {
    let d = project_dir(cwd);
    if scope == Scope::Project && d.is_none() {
        return Err(Error::Pty("project scope needs a working folder".into()));
    }
    Ok(d)
}

#[tauri::command]
pub async fn add_mcp(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
    server: AddMcp,
) -> Result<String> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    let argv = extensions::add_mcp_argv(cli, &server)?;
    let dir = mcp_dir(server.scope, &cwd)?;
    tauri::async_runtime::spawn_blocking(move || run_cli(cli, &h, dir, argv))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn remove_mcp(
    state: State<'_, AppState>,
    cli: profiles::Cli,
    profile: Option<String>,
    cwd: Option<String>,
    name: String,
    scope: Scope,
) -> Result<String> {
    let h = ext_home(&state, cli, profile.as_deref())?;
    let argv = extensions::remove_mcp_argv(cli, &name, scope)?;
    let dir = mcp_dir(scope, &cwd)?;
    tauri::async_runtime::spawn_blocking(move || run_cli(cli, &h, dir, argv))
        .await
        .map_err(|e| Error::Pty(e.to_string()))?
}

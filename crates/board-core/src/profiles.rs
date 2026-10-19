//! Profiles: several accounts / providers for the same CLI.
//!
//! A profile is an *account slot* for Claude Code or Codex:
//! - `Subscription` — the CLI's own login, isolated in its own config dir
//!   (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) so two accounts never share credentials.
//! - `Provider` — an Anthropic-compatible endpoint (Z.ai GLM, Kimi, DeepSeek, MiniMax,
//!   custom) driven through Claude Code via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`.
//!
//! API keys are never written to disk by the app: they live in the OS credential store
//! (Windows Credential Manager) and are only injected into that console's PTY env.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::AgentKind;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// "claude" | "codex"
    pub cli: Cli,
    pub kind: ProfileKind,
    /// Accent for the console tag.
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cli {
    Claude,
    Codex,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProfileKind {
    /// Own login of the CLI, isolated config directory.
    Subscription,
    /// Anthropic-compatible provider through Claude Code.
    #[serde(rename_all = "camelCase")]
    Provider {
        /// Preset id ("zai", "kimi", …) or "custom".
        provider: String,
        base_url: String,
        /// Main model (ANTHROPIC_MODEL); empty → provider default.
        #[serde(default)]
        model: String,
        /// Fast model (ANTHROPIC_SMALL_FAST_MODEL / haiku slot).
        #[serde(default)]
        small_model: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    pub model: &'static str,
    pub small_model: &'static str,
    /// Where to get a key.
    pub key_hint: &'static str,
    /// Supports the plan-usage endpoint we know how to read.
    pub usage: bool,
    /// Model ids offered in the New-console picker (first = default). Empty → free text only.
    pub models: &'static [&'static str],
    /// Context window of the models (tokens) → `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, so
    /// Claude Code does not assume 200k for a model it does not know. 0 = leave unset.
    pub context_window: u64,
}

pub const PRESETS: &[ProviderPreset] = &[
    ProviderPreset {
        id: "zai",
        name: "Z.ai (GLM Coding Plan)",
        base_url: "https://api.z.ai/api/anthropic",
        // per docs.z.ai/devpack/tool/claude (2026-10): lower-case id + [1m] context suffix
        model: "glm-5.3[1m]",
        small_model: "glm-5.3-flash[1m]",
        key_hint: "z.ai → API Keys",
        usage: true,
        models: &["glm-5.3[1m]", "glm-5.3-flash[1m]"],
        context_window: 1_000_000,
    },
    ProviderPreset {
        id: "zai-cn",
        name: "Zhipu BigModel (China)",
        base_url: "https://open.bigmodel.cn/api/anthropic",
        model: "glm-5.3[1m]",
        small_model: "glm-5.3-flash[1m]",
        key_hint: "bigmodel.cn → API Keys",
        usage: false,
        models: &["glm-5.3[1m]", "glm-5.3-flash[1m]"],
        context_window: 1_000_000,
    },
    ProviderPreset {
        id: "kimi",
        name: "Moonshot Kimi",
        base_url: "https://api.moonshot.ai/anthropic",
        model: "kimi-k2-turbo-preview",
        small_model: "kimi-k2-turbo-preview",
        key_hint: "platform.moonshot.ai → API Keys",
        usage: false,
        models: &["kimi-k2-turbo-preview"],
        context_window: 0,
    },
    ProviderPreset {
        id: "deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        small_model: "deepseek-chat",
        key_hint: "platform.deepseek.com → API Keys",
        usage: false,
        models: &["deepseek-chat"],
        context_window: 0,
    },
    ProviderPreset {
        id: "minimax",
        name: "MiniMax",
        base_url: "https://api.minimax.io/anthropic",
        model: "MiniMax-M2",
        small_model: "MiniMax-M2",
        key_hint: "platform.minimax.io → API Keys",
        usage: false,
        models: &["MiniMax-M2"],
        context_window: 0,
    },
    ProviderPreset {
        id: "openrouter",
        name: "OpenRouter",
        base_url: "https://openrouter.ai/api",
        model: "",
        small_model: "",
        key_hint: "openrouter.ai → Keys",
        usage: false,
        models: &[],
        context_window: 0,
    },
];

pub fn preset(id: &str) -> Option<&'static ProviderPreset> {
    PRESETS.iter().find(|p| p.id == id)
}

/// Tidy a hand-typed model id for providers with known naming. For Z.ai / BigModel:
/// "GLM5.3" / "glm 5.3" → "glm-5.3[1m]" (lower-case, dash after `glm`, default 1M context
/// suffix). Other providers' ids are only trimmed — we do not know their rules.
pub fn normalize_model(provider: &str, model: &str) -> String {
    let m = model.trim();
    if m.is_empty() || !matches!(provider, "zai" | "zai-cn") {
        return m.to_string();
    }
    let mut out = m.to_ascii_lowercase().replace([' ', '_'], "-");
    if let Some(rest) = out.strip_prefix("glm") {
        if !rest.starts_with('-') {
            out = format!("glm-{rest}");
        }
    }
    let is_glm5 = out.starts_with("glm-5");
    if is_glm5 && !out.contains('[') {
        out.push_str("[1m]");
    }
    out
}

/// Config dir that isolates a subscription profile's login + sessions.
pub fn config_dir(data_dir: &Path, profile: &Profile) -> PathBuf {
    data_dir.join("profiles").join(safe(&profile.id))
}

fn safe(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Can `profile` drive a console of `agent`?
pub fn compatible(profile: &Profile, agent: &AgentKind) -> bool {
    matches!(
        (profile.cli, agent),
        (Cli::Claude, AgentKind::ClaudeCode) | (Cli::Codex, AgentKind::Codex)
    )
}

/// Env vars for a console using `profile`. `key` is the provider API key (from the keyring).
pub fn env_for(profile: &Profile, data_dir: &Path, key: Option<&str>) -> Vec<(String, String)> {
    let mut env = Vec::new();
    match (&profile.kind, profile.cli) {
        (ProfileKind::Subscription, Cli::Claude) => {
            env.push((
                "CLAUDE_CONFIG_DIR".into(),
                config_dir(data_dir, profile).display().to_string(),
            ));
        }
        (ProfileKind::Subscription, Cli::Codex) => {
            env.push((
                "CODEX_HOME".into(),
                config_dir(data_dir, profile).display().to_string(),
            ));
        }
        (
            ProfileKind::Provider {
                provider,
                base_url,
                model,
                small_model,
            },
            _,
        ) => {
            let model = normalize_model(provider, model);
            let small_model = normalize_model(provider, small_model);
            let (model, small_model) = (&model, &small_model);
            // own config dir too: provider sessions must not mix with the user's Claude login
            env.push((
                "CLAUDE_CONFIG_DIR".into(),
                config_dir(data_dir, profile).display().to_string(),
            ));
            env.push(("ANTHROPIC_BASE_URL".into(), base_url.clone()));
            if let Some(k) = key {
                env.push(("ANTHROPIC_AUTH_TOKEN".into(), k.into()));
            }
            if !model.is_empty() {
                env.push(("ANTHROPIC_MODEL".into(), model.clone()));
                env.push(("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), model.clone()));
                env.push(("ANTHROPIC_DEFAULT_SONNET_MODEL".into(), model.clone()));
            }
            if !small_model.is_empty() {
                env.push(("ANTHROPIC_SMALL_FAST_MODEL".into(), small_model.clone()));
                env.push(("ANTHROPIC_DEFAULT_HAIKU_MODEL".into(), small_model.clone()));
            }
            env.push(("API_TIMEOUT_MS".into(), "3000000".into()));
            if let Some(cw) = preset(provider)
                .map(|p| p.context_window)
                .filter(|c| *c > 0)
            {
                env.push(("CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(), cw.to_string()));
            }
            env.push((
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
                "1".into(),
            ));
        }
    }
    env
}

pub fn needs_key(profile: &Profile) -> bool {
    matches!(profile.kind, ProfileKind::Provider { .. })
}

// ---------- key storage (OS credential store) ----------

const SERVICE: &str = "agent-board";

pub trait KeyStore: Send + Sync {
    fn get(&self, profile_id: &str) -> Option<String>;
    fn set(&self, profile_id: &str, key: &str) -> crate::Result<()>;
    fn delete(&self, profile_id: &str) -> crate::Result<()>;
}

/// Windows Credential Manager / macOS Keychain. (Linux dev builds: in-memory only.)
pub struct OsKeyStore;

#[cfg(any(windows, target_os = "macos"))]
impl KeyStore for OsKeyStore {
    fn get(&self, id: &str) -> Option<String> {
        keyring::Entry::new(SERVICE, &format!("profile:{id}"))
            .ok()?
            .get_password()
            .ok()
    }
    fn set(&self, id: &str, key: &str) -> crate::Result<()> {
        keyring::Entry::new(SERVICE, &format!("profile:{id}"))
            .and_then(|e| e.set_password(key))
            .map_err(|e| crate::Error::Pty(format!("credential store: {e}")))
    }
    fn delete(&self, id: &str) -> crate::Result<()> {
        match keyring::Entry::new(SERVICE, &format!("profile:{id}"))
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(crate::Error::Pty(format!("credential store: {e}"))),
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
static FALLBACK: std::sync::OnceLock<MemKeyStore> = std::sync::OnceLock::new();

#[cfg(not(any(windows, target_os = "macos")))]
impl KeyStore for OsKeyStore {
    fn get(&self, id: &str) -> Option<String> {
        FALLBACK.get_or_init(MemKeyStore::default).get(id)
    }
    fn set(&self, id: &str, key: &str) -> crate::Result<()> {
        let _ = SERVICE;
        FALLBACK.get_or_init(MemKeyStore::default).set(id, key)
    }
    fn delete(&self, id: &str) -> crate::Result<()> {
        FALLBACK.get_or_init(MemKeyStore::default).delete(id)
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemKeyStore(parking_lot::Mutex<std::collections::HashMap<String, String>>);

impl KeyStore for MemKeyStore {
    fn get(&self, id: &str) -> Option<String> {
        self.0.lock().get(id).cloned()
    }
    fn set(&self, id: &str, key: &str) -> crate::Result<()> {
        self.0.lock().insert(id.into(), key.into());
        Ok(())
    }
    fn delete(&self, id: &str) -> crate::Result<()> {
        self.0.lock().remove(id);
        Ok(())
    }
}

/// Mask a key for display: "abcd…wxyz".
pub fn mask(key: &str) -> String {
    let k = key.trim();
    if k.chars().count() <= 8 {
        return "••••".into();
    }
    let head: String = k.chars().take(4).collect();
    let tail: String = k
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zai() -> Profile {
        let p = preset("zai").unwrap();
        Profile {
            id: "p1".into(),
            name: "Z.ai".into(),
            cli: Cli::Claude,
            kind: ProfileKind::Provider {
                provider: "zai".into(),
                base_url: p.base_url.into(),
                model: p.model.into(),
                small_model: p.small_model.into(),
            },
            color: String::new(),
        }
    }

    fn get<'a>(env: &'a [(String, String)], k: &str) -> Option<&'a str> {
        env.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }

    #[test]
    fn provider_env_points_claude_at_endpoint() {
        let env = env_for(&zai(), Path::new("/data"), Some("sk-123"));
        assert_eq!(
            get(&env, "ANTHROPIC_BASE_URL"),
            Some("https://api.z.ai/api/anthropic")
        );
        assert_eq!(get(&env, "ANTHROPIC_AUTH_TOKEN"), Some("sk-123"));
        assert_eq!(get(&env, "ANTHROPIC_MODEL"), Some("glm-5.3[1m]"));
        assert_eq!(
            get(&env, "ANTHROPIC_DEFAULT_OPUS_MODEL"),
            Some("glm-5.3[1m]")
        );
        assert_eq!(
            get(&env, "ANTHROPIC_DEFAULT_HAIKU_MODEL"),
            Some("glm-5.3-flash[1m]")
        );
        assert_eq!(
            get(&env, "CLAUDE_CODE_AUTO_COMPACT_WINDOW"),
            Some("1000000")
        );
        assert!(get(&env, "CLAUDE_CONFIG_DIR").unwrap().ends_with("p1"));
        assert!(get(
            &env_for(&zai(), Path::new("/d"), None),
            "ANTHROPIC_AUTH_TOKEN"
        )
        .is_none());
    }

    #[test]
    fn subscription_profiles_isolate_config() {
        let mut p = zai();
        p.kind = ProfileKind::Subscription;
        p.id = "work/../x".into();
        let env = env_for(&p, Path::new("/data"), None);
        assert_eq!(env.len(), 1);
        let dir = get(&env, "CLAUDE_CONFIG_DIR").unwrap();
        assert!(dir.ends_with("work____x"), "{dir}");
        assert!(!dir.contains(".."));
        p.cli = Cli::Codex;
        assert_eq!(env_for(&p, Path::new("/data"), None)[0].0, "CODEX_HOME");
    }

    #[test]
    fn compatibility_and_json() {
        let p = zai();
        assert!(compatible(&p, &AgentKind::ClaudeCode));
        assert!(!compatible(&p, &AgentKind::Codex));
        let j = serde_json::to_value(&p).unwrap();
        assert_eq!(j["kind"]["type"], "provider");
        assert_eq!(j["kind"]["baseUrl"], "https://api.z.ai/api/anthropic");
        let back: Profile = serde_json::from_value(j).unwrap();
        assert_eq!(back, p);
        let s: Profile = serde_json::from_str(
            r#"{"id":"a","name":"Work","cli":"codex","kind":{"type":"subscription"}}"#,
        )
        .unwrap();
        assert_eq!(s.kind, ProfileKind::Subscription);
    }

    #[test]
    fn mask_and_memstore() {
        assert_eq!(mask("abcdefghijkl"), "abcd…ijkl");
        assert_eq!(mask("short"), "••••");
        let m = MemKeyStore::default();
        m.set("p", "k").unwrap();
        assert_eq!(m.get("p").as_deref(), Some("k"));
        m.delete("p").unwrap();
        assert!(m.get("p").is_none());
    }

    #[test]
    fn normalizes_hand_typed_glm_ids() {
        assert_eq!(normalize_model("zai", "GLM5.3"), "glm-5.3[1m]");
        assert_eq!(
            normalize_model("zai", " glm 5.3-flash "),
            "glm-5.3-flash[1m]"
        );
        assert_eq!(normalize_model("zai", "glm-5.3[1m]"), "glm-5.3[1m]");
        assert_eq!(normalize_model("zai", "glm-4.6"), "glm-4.6");
        assert_eq!(normalize_model("zai", ""), "");
        assert_eq!(normalize_model("kimi", " Kimi-K2 "), "Kimi-K2");
        // a hand-typed "GLM5.3" profile now launches with the right id
        let mut p = zai();
        if let ProfileKind::Provider { model, .. } = &mut p.kind {
            *model = "GLM5.3".into();
        }
        let env = env_for(&p, Path::new("/d"), None);
        assert_eq!(get(&env, "ANTHROPIC_MODEL"), Some("glm-5.3[1m]"));
    }

    #[test]
    fn context_window_only_for_known_presets() {
        let mut p = zai();
        if let ProfileKind::Provider { provider, .. } = &mut p.kind {
            *provider = "kimi".into();
        }
        let env = env_for(&p, Path::new("/d"), None);
        assert!(get(&env, "CLAUDE_CODE_AUTO_COMPACT_WINDOW").is_none());
        assert!(PRESETS
            .iter()
            .all(|p| p.models.is_empty() || p.models[0] == p.model));
    }
}

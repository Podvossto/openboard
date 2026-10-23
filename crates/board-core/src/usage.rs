//! Claude plan usage (5h session / 7-day) — the same endpoint Claude Code's `/usage` uses.
//! Reads Claude Code's OAuth token read-only; never refreshes or stores it.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub percent: f64,
    pub resets_at: Option<String>,
}

/// Weekly window scoped to one model family (Anthropic `seven_day_opus` / `seven_day_sonnet`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelWindow {
    pub model: String,
    pub percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub session: Option<Window>,
    pub weekly: Option<Window>,
    /// per-model weekly limits when the plan reports them (empty otherwise)
    pub weekly_models: Vec<ModelWindow>,
    pub error: Option<String>,
}

pub fn parse(v: &serde_json::Value) -> Usage {
    let w = |k: &str| {
        let o = v.get(k)?;
        Some(Window {
            percent: o.get("utilization")?.as_f64()?,
            resets_at: o
                .get("resets_at")
                .and_then(|r| r.as_str())
                .map(str::to_owned),
        })
    };
    let weekly_models = [("Opus", "seven_day_opus"), ("Sonnet", "seven_day_sonnet")]
        .into_iter()
        .filter_map(|(model, key)| {
            w(key).map(|x| ModelWindow {
                model: model.into(),
                percent: x.percent,
                resets_at: x.resets_at,
            })
        })
        .collect();
    Usage {
        session: w("five_hour"),
        weekly: w("seven_day"),
        weekly_models,
        error: None,
    }
}

/// Claude usage for a given config dir (default `~/.claude`, or a profile's CLAUDE_CONFIG_DIR).
pub fn fetch_claude_dir(config_dir: &Path) -> Usage {
    fetch_claude_creds(&config_dir.join(".credentials.json"))
}

pub fn fetch_claude(home: &Path) -> Usage {
    fetch_claude_creds(&home.join(".claude").join(".credentials.json"))
}

fn fetch_claude_creds(path: &Path) -> Usage {
    let err = |e: &str| Usage {
        error: Some(e.into()),
        ..Default::default()
    };
    let Some(creds) = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
    else {
        return err("not logged in");
    };
    let Some(tok) = creds
        .pointer("/claudeAiOauth/accessToken")
        .and_then(|t| t.as_str())
    else {
        return err("not logged in");
    };
    // Claude Code refreshes this token only while it runs: an expired one gives a clear
    // hint instead of a bare HTTP 401 (we never refresh tokens ourselves).
    let expired = creds
        .pointer("/claudeAiOauth/expiresAt")
        .and_then(|v| v.as_i64())
        .is_some_and(|ms| ms < now_ms());
    let res = agent()
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", &format!("Bearer {tok}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "openboard")
        .call();
    match res {
        Ok(mut r) if r.status().is_success() => match r.body_mut().read_json::<serde_json::Value>()
        {
            Ok(v) => parse(&v),
            Err(e) => err(&e.to_string()),
        },
        Ok(r) => err(&http_hint(r.status().as_u16(), expired)),
        Err(e) => err(&format!("can't reach api.anthropic.com ({e})")),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Human message for a failed usage call.
pub fn http_hint(status: u16, token_expired: bool) -> String {
    match status {
        401 | 403 if token_expired => {
            "login expired — open any Claude console once to refresh it".into()
        }
        401 | 403 => "login not accepted — run /login in a Claude console".into(),
        429 => "rate limited — try again in a minute".into(),
        s => format!("HTTP {s}"),
    }
}

fn agent() -> ureq::Agent {
    let b = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false);
    #[cfg(windows)]
    let b = b.tls_config(
        ureq::tls::TlsConfig::builder()
            .provider(ureq::tls::TlsProvider::NativeTls)
            .build(),
    );
    b.build().new_agent()
}

/// Z.ai GLM Coding Plan quota (`/api/monitor/usage/quota/limit`, raw-key auth).
/// unit 3 = 5-hour window, unit 6 = weekly.
pub fn parse_zai(v: &serde_json::Value) -> Usage {
    let data = v.get("data").unwrap_or(v);
    let mut u = Usage::default();
    for item in data
        .get("limits")
        .and_then(|l| l.as_array())
        .into_iter()
        .flatten()
    {
        let Some(pct) = item.get("percentage").and_then(|p| p.as_f64()) else {
            continue;
        };
        let resets_at = item
            .get("nextResetTime")
            .and_then(|r| r.as_i64())
            .map(|ms| ms.to_string());
        let w = Some(Window {
            percent: pct,
            resets_at,
        });
        match item.get("unit").and_then(|x| x.as_i64()) {
            Some(3) => u.session = w,
            Some(6) => u.weekly = w,
            _ => {}
        }
    }
    if u.session.is_none() && u.weekly.is_none() {
        u.error = Some("no quota data".into());
    }
    u
}

pub fn fetch_zai(key: &str) -> Usage {
    let err = |e: String| Usage {
        error: Some(e),
        ..Default::default()
    };
    match agent()
        .get("https://api.z.ai/api/monitor/usage/quota/limit")
        .header("Authorization", key)
        .header("Accept-Language", "en-US,en")
        .call()
    {
        Ok(mut r) if r.status().is_success() => match r.body_mut().read_json::<serde_json::Value>()
        {
            Ok(v) => parse_zai(&v),
            Err(e) => err(e.to_string()),
        },
        Ok(r) => err(format!("HTTP {}", r.status().as_u16())),
        Err(e) => err(e.to_string()),
    }
}

/// Codex has no usage API: read the latest `rate_limits` snapshot it writes into its
/// session logs (`$CODEX_HOME/sessions/**/rollout-*.jsonl`).
pub fn fetch_codex(codex_home: &Path) -> Usage {
    let mut files = Vec::new();
    collect_jsonl(&codex_home.join("sessions"), &mut files, 0);
    files.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    for (_, f) in files.into_iter().take(5) {
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        for line in text.lines().rev() {
            if !line.contains("rate_limits") {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(u) = parse_codex_line(&v) {
                    return u;
                }
            }
        }
    }
    Usage {
        error: Some("no Codex session data yet".into()),
        ..Default::default()
    }
}

pub fn parse_codex_line(v: &serde_json::Value) -> Option<Usage> {
    let rl = v
        .pointer("/payload/rate_limits")
        .or_else(|| v.pointer("/payload/info/rate_limits"))
        .or_else(|| v.get("rate_limits"))?;
    let w = |k: &str| {
        let o = rl.get(k)?;
        Some(Window {
            percent: o.get("used_percent")?.as_f64()?,
            resets_at: o.get("resets_at").and_then(|r| {
                r.as_i64()
                    .map(|s| (s * 1000).to_string())
                    .or_else(|| r.as_str().map(str::to_owned))
            }),
        })
    };
    let u = Usage {
        session: w("primary"),
        weekly: w("secondary"),
        error: None,
        ..Default::default()
    };
    (u.session.is_some() || u.weekly.is_some()).then_some(u)
}

fn collect_jsonl(
    dir: &Path,
    out: &mut Vec<(std::time::SystemTime, std::path::PathBuf)>,
    depth: u8,
) {
    if depth > 4 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_jsonl(&p, out, depth + 1);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                out.push((m, p));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usage_payload() {
        let v = serde_json::json!({
            "five_hour": {"utilization": 12.0, "resets_at": "2026-10-18T10:00:00Z"},
            "seven_day": {"utilization": 90.5, "resets_at": null},
            "seven_day_opus": null,
            "seven_day_sonnet": {"utilization": 17.0, "resets_at": "2026-10-23T09:00:00Z"}
        });
        let u = parse(&v);
        assert_eq!(u.session.unwrap().percent, 12.0);
        assert_eq!(u.weekly.as_ref().unwrap().percent, 90.5);
        assert_eq!(u.weekly.unwrap().resets_at, None);
        // null opus window is skipped; sonnet is kept
        assert_eq!(u.weekly_models.len(), 1);
        assert_eq!(u.weekly_models[0].model, "Sonnet");
        assert_eq!(u.weekly_models[0].percent, 17.0);
    }

    #[test]
    fn parses_zai_quota() {
        let v = serde_json::json!({"code":200,"data":{"level":"pro","limits":[
            {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":42,"nextResetTime":1760800000000i64},
            {"type":"TOKENS_LIMIT","unit":6,"percentage":7},
            {"type":"TIME_LIMIT","unit":5,"percentage":1}
        ]}});
        let u = parse_zai(&v);
        assert_eq!(u.session.as_ref().unwrap().percent, 42.0);
        assert_eq!(
            u.session.unwrap().resets_at.as_deref(),
            Some("1760800000000")
        );
        assert_eq!(u.weekly.unwrap().percent, 7.0);
        assert!(parse_zai(&serde_json::json!({"data":{}})).error.is_some());
    }

    #[test]
    fn reads_codex_rate_limits_from_session_log() {
        let d = tempfile::tempdir().unwrap();
        let day = d.path().join("sessions/2026/10/18");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-x.jsonl"),
            concat!(
                r#"{"type":"session_meta","payload":{}}"#, "\n",
                r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":12.5,"window_minutes":300,"resets_at":1760800000},"secondary":{"used_percent":40.0}}}}"#, "\n",
                r#"{"type":"event_msg","payload":{"type":"agent_message"}}"#, "\n"
            ),
        )
        .unwrap();
        let u = fetch_codex(d.path());
        assert_eq!(u.session.as_ref().unwrap().percent, 12.5);
        assert_eq!(
            u.session.unwrap().resets_at.as_deref(),
            Some("1760800000000")
        );
        assert_eq!(u.weekly.unwrap().percent, 40.0);
        assert!(fetch_codex(&d.path().join("nope")).error.is_some());
    }

    #[test]
    fn http_hints_are_actionable() {
        assert!(http_hint(401, true).contains("open any Claude console"));
        assert!(http_hint(401, false).contains("/login"));
        assert!(http_hint(429, false).contains("rate limited"));
        assert_eq!(http_hint(500, false), "HTTP 500");
    }

    #[test]
    fn missing_credentials_is_soft_error() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(
            fetch_claude(d.path()).error.as_deref(),
            Some("not logged in")
        );
    }
}

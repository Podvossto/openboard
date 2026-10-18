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

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub session: Option<Window>,
    pub weekly: Option<Window>,
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
    Usage {
        session: w("five_hour"),
        weekly: w("seven_day"),
        error: None,
    }
}

pub fn fetch_claude(home: &Path) -> Usage {
    let err = |e: &str| Usage {
        error: Some(e.into()),
        ..Default::default()
    };
    let Some(creds) = std::fs::read(home.join(".claude").join(".credentials.json"))
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
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .http_status_as_error(false)
        .build()
        .new_agent();
    let res = agent
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", &format!("Bearer {tok}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "agent-board")
        .call();
    match res {
        Ok(mut r) if r.status().is_success() => match r.body_mut().read_json::<serde_json::Value>()
        {
            Ok(v) => parse(&v),
            Err(e) => err(&e.to_string()),
        },
        Ok(r) => err(&format!("HTTP {}", r.status().as_u16())),
        Err(e) => err(&e.to_string()),
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
            "seven_day_opus": null
        });
        let u = parse(&v);
        assert_eq!(u.session.unwrap().percent, 12.0);
        assert_eq!(u.weekly.as_ref().unwrap().percent, 90.5);
        assert_eq!(u.weekly.unwrap().resets_at, None);
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

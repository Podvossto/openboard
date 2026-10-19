//! Web tile "real browser": pure helpers for the native child WebView that src-tauri
//! places over a web tile (iframes can't show sites that send `X-Frame-Options` / CSP
//! `frame-ancestors`, e.g. google.com → "refused to connect").
//!
//! Security model: the child webview loads arbitrary sites, so it must never get the app's
//! IPC. Tauri only grants commands to the app's own origin by default (remote origins are
//! denied unless a capability lists them in `remote.urls`), and the webview gets its own
//! label so no window-scoped capability matches it. Navigation is limited to http(s).

use serde::{Deserialize, Serialize};

/// Webview label for a tile — tile ids are uuids; anything else is rejected so a label can
/// never collide with the main webview or contain characters Tauri rejects.
pub fn label_for(tile_id: &str) -> Option<String> {
    let ok = !tile_id.is_empty()
        && tile_id.len() <= 64
        && tile_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| format!("webtile-{tile_id}"))
}

/// Accept only http(s) URLs. Bare hosts get a scheme: localhost / 127.x / [::1] → http, else https.
pub fn normalize_url(input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("empty URL".into());
    }
    let has_scheme = s
        .split_once("://")
        .map(|(scheme, _)| {
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
        })
        .unwrap_or(false);
    let with_scheme = if has_scheme {
        s.to_string()
    } else {
        let local = s.starts_with("localhost") || s.starts_with("127.") || s.starts_with("[::1]");
        format!("{}://{s}", if local { "http" } else { "https" })
    };
    let lower = with_scheme.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(format!("only http(s) URLs are allowed: {s}"));
    }
    if with_scheme
        .chars()
        .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("URL contains spaces or control characters".into());
    }
    let rest = &with_scheme[with_scheme.find("://").unwrap() + 3..];
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.starts_with(':') || host.contains('@') {
        return Err(format!("invalid host in {s}"));
    }
    Ok(with_scheme)
}

/// Is a navigation target allowed inside the tile? (blocks javascript:, file:, custom schemes)
pub fn allow_navigation(url: &str) -> bool {
    let l = url.trim_start().to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://") || l == "about:blank"
}

/// Logical (CSS px) rectangle of the tile body relative to the main window's content.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    /// Rounded to whole px; `None` if not finite or smaller than 2×2 (= hide the webview).
    pub fn sanitize(self) -> Option<Rect> {
        let vals = [self.x, self.y, self.w, self.h];
        if vals.iter().any(|v| !v.is_finite()) || self.w < 2.0 || self.h < 2.0 {
            return None;
        }
        Some(Rect {
            x: self.x.round(),
            y: self.y.round(),
            w: self.w.round().min(16384.0),
            h: self.h.round().min(16384.0),
        })
    }
}

/// Page zoom for the webview: canvas zoom × device-preset scale, clamped to what WebView2 accepts.
pub fn clamp_zoom(z: f64) -> f64 {
    if !z.is_finite() || z <= 0.0 {
        return 1.0;
    }
    z.clamp(0.25, 5.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_only_for_safe_ids() {
        assert_eq!(label_for("3f2a-9c_1").as_deref(), Some("webtile-3f2a-9c_1"));
        assert!(label_for("").is_none());
        assert!(label_for("main").is_some()); // prefixed, can't equal "main"
        assert!(label_for("../x").is_none());
        assert!(label_for("a b").is_none());
        assert!(label_for(&"a".repeat(65)).is_none());
    }

    #[test]
    fn urls_get_scheme_and_only_http() {
        assert_eq!(normalize_url("google.com").unwrap(), "https://google.com");
        assert_eq!(
            normalize_url(" localhost:5173/x ").unwrap(),
            "http://localhost:5173/x"
        );
        assert_eq!(
            normalize_url("127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            normalize_url("HTTPS://Example.com/a?b#c").unwrap(),
            "HTTPS://Example.com/a?b#c"
        );
        assert!(normalize_url("").is_err());
        assert!(normalize_url("javascript://alert(1)").is_err());
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("https://").is_err());
        assert!(normalize_url("https://user@evil.com").is_err());
        assert!(normalize_url("https://a b.com").is_err());
    }

    #[test]
    fn navigation_filter() {
        assert!(allow_navigation("https://accounts.google.com/x"));
        assert!(allow_navigation("http://localhost:3000"));
        assert!(allow_navigation("about:blank"));
        assert!(!allow_navigation("javascript:alert(1)"));
        assert!(!allow_navigation("file:///C:/Windows"));
        assert!(!allow_navigation("ms-settings:"));
    }

    #[test]
    fn rect_sanitize_and_zoom() {
        let r = Rect {
            x: 10.4,
            y: 20.6,
            w: 300.2,
            h: 200.5,
        };
        assert_eq!(
            r.sanitize(),
            Some(Rect {
                x: 10.0,
                y: 21.0,
                w: 300.0,
                h: 201.0
            })
        );
        assert!(Rect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 50.0
        }
        .sanitize()
        .is_none());
        assert!(Rect {
            x: f64::NAN,
            y: 0.0,
            w: 10.0,
            h: 10.0
        }
        .sanitize()
        .is_none());
        assert_eq!(clamp_zoom(0.1), 0.25);
        assert_eq!(clamp_zoom(f64::INFINITY), 1.0);
        assert_eq!(clamp_zoom(1.25), 1.25);
    }
}

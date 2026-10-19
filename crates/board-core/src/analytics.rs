//! Usage analytics from LOCAL session logs — no network, nothing leaves the machine.
//!
//! Sources (see `Source`):
//! - Claude Code `<config>/projects/**/*.jsonl`: `type:"assistant"` lines carry
//!   `message.usage` (input + output + cache tokens). Streamed messages repeat —
//!   dedupe by `message.id` + `requestId`.
//! - Codex `<home>/sessions/**/rollout-*.jsonl`: `token_count` events. Their
//!   `info.total_token_usage` is CUMULATIVE per session — take deltas between
//!   events (or `last_token_usage` when totals are absent), never the raw totals.
//!
//! Files whose mtime predates the window are skipped whole; lines are streamed
//! (never `read_to_string`) and cheap substring-prefiltered before JSON parsing.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Duration, Local, LocalResult, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

const MAX_DAYS: usize = 400;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    /// Oldest → newest, exactly `days` entries (zero-filled gaps included).
    pub days: Vec<DayStats>,
    pub totals: Totals,
    pub streaks: Streaks,
    pub peak_day: Option<PeakDay>,
    pub top_agent: Option<TopAgent>,
    /// Claude model id → tokens over the window (Codex logs carry no per-message model).
    pub models: BTreeMap<String, u64>,
    /// Longest single session (first → last logged message) in seconds; 0 when unknown.
    pub longest_session_secs: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    /// "YYYY-MM-DD", local time
    pub date: String,
    /// agent id ("claude", "codex") → tokens
    pub by_agent: BTreeMap<String, u64>,
    pub sessions: u64,
    pub messages: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub tokens: u64,
    pub sessions: u64,
    pub messages: u64,
    pub active_days: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Streaks {
    /// Consecutive active days ending today (or yesterday when today is quiet so far).
    pub current: u64,
    pub longest: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakDay {
    pub date: String,
    pub tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopAgent {
    pub agent: String,
    pub tokens: u64,
}

/// One session-log location to scan.
#[derive(Debug, Clone)]
pub enum Source {
    /// A Claude Code config dir (`~/.claude`, `$CLAUDE_CONFIG_DIR` or a profile's).
    Claude { dir: PathBuf, tag: String },
    /// A Codex home (`~/.codex`, `$CODEX_HOME` or a profile's).
    Codex { home: PathBuf, tag: String },
}

/// Default log locations: env overrides, then `~/.claude` / `~/.codex`, plus every
/// profile's isolated config dir. `data_dir` is the app data dir (profile roots).
pub fn default_sources(
    home: &Path,
    data_dir: &Path,
    profiles: &[crate::profiles::Profile],
) -> Vec<Source> {
    let mut out = vec![
        Source::Claude {
            dir: home.join(".claude"),
            tag: "claude".into(),
        },
        Source::Codex {
            home: home.join(".codex"),
            tag: "codex".into(),
        },
    ];
    // an env override may point elsewhere (dev machines, wrapper scripts) — scan it too
    push_env(&mut out, "CLAUDE_CONFIG_DIR", home.join(".claude"), true);
    push_env(&mut out, "CODEX_HOME", home.join(".codex"), false);
    for p in profiles {
        let dir = crate::profiles::config_dir(data_dir, p);
        let tag = format!("p-{}", p.id);
        match p.cli {
            crate::profiles::Cli::Claude => out.push(Source::Claude { dir, tag }),
            crate::profiles::Cli::Codex => out.push(Source::Codex { home: dir, tag }),
        }
    }
    out
}

/// Add the env dir when it is set and not already covered by the default.
fn push_env(out: &mut Vec<Source>, var: &str, default: PathBuf, claude: bool) {
    let Some(dir) = std::env::var_os(var).map(PathBuf::from) else {
        return;
    };
    if dir == default || !dir.is_dir() {
        return;
    }
    let tag = format!("{var}-dir");
    if claude {
        out.push(Source::Claude { dir, tag });
    } else {
        out.push(Source::Codex { home: dir, tag });
    }
}

/// Aggregate `sources` over the last `days` days (local time), zero-filling gaps.
pub fn collect(sources: &[Source], days: usize) -> Analytics {
    let days = days.clamp(1, MAX_DAYS);
    let today = Local::now().date_naive();
    let start = today - Duration::days(days as i64 - 1);
    // one day of slack: a file touched at 23:59 in another offset must not be skipped
    let cutoff = local_midnight(start - Duration::days(1));
    let mut agg = Agg {
        start: Some(start),
        end: Some(today),
        ..Agg::default()
    };
    for src in sources {
        match src {
            Source::Claude { dir, tag } => {
                scan_claude(&dir.join("projects"), tag, cutoff, &mut agg)
            }
            Source::Codex { home, tag } => {
                scan_codex(&home.join("sessions"), tag, cutoff, &mut agg)
            }
        }
    }
    agg.finish(days)
}

/// Token usage of ONE Claude session (per-console usage).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub tokens: u64,
    pub messages: u64,
    /// model of the most recent message, when logged
    pub model: Option<String>,
}

/// Sum tokens per Claude session id. Claude Code stores a session in
/// `<config>/projects/<project>/<sessionId>.jsonl`, so only files whose stem is a
/// requested id are read. Same `message.id`+`requestId` dedupe as `collect`. Ids with
/// no log are absent from the result (never zero-filled).
pub fn session_usage(sources: &[Source], ids: &[String]) -> HashMap<String, SessionUsage> {
    let want: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let mut out: HashMap<String, SessionUsage> = HashMap::new();
    for src in sources {
        let Source::Claude { dir, .. } = src else {
            continue;
        };
        for path in jsonl_files(&dir.join("projects"), SystemTime::UNIX_EPOCH) {
            let key = file_key(&path);
            if !want.contains(key.as_str()) {
                continue;
            }
            let Ok(file) = std::fs::File::open(&path) else {
                continue;
            };
            let mut seen: HashSet<(String, String)> = HashSet::new();
            for line in std::io::BufReader::new(file).lines() {
                let Ok(line) = line else { break };
                if !line.contains("\"assistant\"") {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<ClaudeLine>(&line) else {
                    continue;
                };
                if v.ty != Some("assistant") {
                    continue;
                }
                let Some(m) = v.message else { continue };
                let Some(u) = m.usage else { continue };
                let k = (
                    m.id.or(v.uuid).unwrap_or_default().to_owned(),
                    v.request_id.unwrap_or_default().to_owned(),
                );
                if !seen.insert(k) {
                    continue;
                }
                let e = out.entry(key.clone()).or_default();
                e.tokens += u.total();
                e.messages += 1;
                if let Some(model) = m.model.filter(|m| real_model(m)) {
                    e.model = Some(model.to_owned());
                }
            }
        }
    }
    out
}

// ---------- Claude Code logs ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeLine<'a> {
    #[serde(borrow, rename = "type")]
    ty: Option<&'a str>,
    #[serde(borrow)]
    timestamp: Option<&'a str>,
    #[serde(borrow)]
    session_id: Option<&'a str>,
    /// per-line id (dedupe fallback when message.id is absent)
    #[serde(borrow)]
    uuid: Option<&'a str>,
    request_id: Option<&'a str>,
    message: Option<ClaudeMessage<'a>>,
}

#[derive(Deserialize)]
struct ClaudeMessage<'a> {
    #[serde(borrow)]
    id: Option<&'a str>,
    #[serde(borrow)]
    model: Option<&'a str>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize)]
struct ClaudeUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

impl ClaudeUsage {
    fn total(&self) -> u64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_creation_input_tokens)
            .saturating_add(self.cache_read_input_tokens)
    }
}

fn scan_claude(dir: &Path, tag: &str, cutoff: SystemTime, agg: &mut Agg) {
    for path in jsonl_files(dir, cutoff) {
        let Ok(file) = std::fs::File::open(&path) else {
            continue;
        };
        for line in std::io::BufReader::new(file).lines() {
            // only assistant lines carry usage; skip the JSON parse for everything else
            let Ok(line) = line else { break };
            if !line.contains("\"assistant\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<ClaudeLine>(&line) else {
                continue;
            };
            if v.ty != Some("assistant") {
                continue;
            }
            let Some(m) = v.message else { continue };
            let Some(u) = m.usage else { continue };
            let Some(day) = v
                .timestamp
                .and_then(parse_day)
                .filter(|d| agg.in_window(*d))
            else {
                continue;
            };
            let key = (
                m.id.or(v.uuid).unwrap_or_default().to_owned(),
                v.request_id.unwrap_or_default().to_owned(),
            );
            if !agg.seen.insert(key) {
                continue;
            }
            if let Some(model) = m.model.filter(|m| real_model(m)) {
                *agg.models.entry(model.to_owned()).or_insert(0) += u.total();
            }
            if let (Some(s), Some(t)) = (v.session_id, v.timestamp.and_then(parse_secs)) {
                agg.span(format!("{tag}:{s}"), t);
            }
            let day = agg.day_entry(day);
            *day.by_agent.entry("claude".into()).or_insert(0) += u.total();
            day.messages += 1;
            if let Some(s) = v.session_id {
                day.sessions.insert(format!("{tag}:{s}"));
            }
        }
    }
}

// ---------- Codex logs ----------

#[derive(Deserialize, Clone, Copy)]
struct CodexLine<'a> {
    #[serde(borrow)]
    timestamp: Option<&'a str>,
    payload: Option<CodexPayload<'a>>,
}

#[derive(Deserialize, Clone, Copy)]
struct CodexPayload<'a> {
    #[serde(borrow, rename = "type")]
    ty: Option<&'a str>,
    info: Option<CodexInfo>,
}

#[derive(Deserialize, Clone, Copy)]
struct CodexInfo {
    total_token_usage: Option<TokenUsage>,
    last_token_usage: Option<TokenUsage>,
}

#[derive(Deserialize, Default, Clone, Copy)]
struct TokenUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

impl TokenUsage {
    fn total(&self) -> u64 {
        self.input_tokens
            .saturating_add(self.cached_input_tokens)
            .saturating_add(self.output_tokens)
    }
}

fn scan_codex(dir: &Path, tag: &str, cutoff: SystemTime, agg: &mut Agg) {
    for path in jsonl_files(dir, cutoff) {
        let Ok(file) = std::fs::File::open(&path) else {
            continue;
        };
        let mut prev_total: Option<u64> = None;
        let mut last_day: Option<NaiveDate> = None;
        let mut touched = false;
        for line in std::io::BufReader::new(file).lines() {
            let Ok(line) = line else { break };
            if !(line.contains("\"token_count\"") || line.contains("\"agent_message\"")) {
                continue;
            }
            let Ok(v) = serde_json::from_str::<CodexLine>(&line) else {
                continue;
            };
            let in_day = v
                .timestamp
                .and_then(parse_day)
                .filter(|d| agg.in_window(*d));
            let day = || in_day;
            let payload = match v.payload {
                Some(p) => p,
                None => continue,
            };
            if let Some(t) = v
                .timestamp
                .and_then(parse_secs)
                .filter(|_| in_day.is_some())
            {
                agg.span(format!("{tag}:{}", file_key(&path)), t);
            }
            match payload.ty {
                Some("token_count") => {
                    let Some(info) = payload.info else { continue };
                    let total = info.total_token_usage.map(|t| t.total());
                    let delta = match (total, prev_total) {
                        (Some(t), Some(prev)) => t.saturating_sub(prev),
                        (Some(t), None) => t,
                        (None, _) => info.last_token_usage.map_or(0, |t| t.total()),
                    };
                    if total.is_some() {
                        prev_total = total;
                    }
                    if let Some(day) = day() {
                        if delta > 0 {
                            let e = agg.day_entry(day);
                            *e.by_agent.entry("codex".into()).or_insert(0) += delta;
                            touched = true;
                        }
                        last_day = Some(day);
                    }
                }
                Some("agent_message") => {
                    if let Some(day) = day() {
                        agg.day_entry(day).messages += 1;
                        touched = true;
                        last_day = Some(day);
                    }
                }
                _ => {}
            }
        }
        // one session per rollout file, counted on its last active day
        if let Some(day) = last_day.filter(|_| touched) {
            let key = file_key(&path);
            agg.day_entry(day).sessions.insert(format!("{tag}:{key}"));
        }
    }
}

fn file_key(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Claude writes `<synthetic>` for locally generated (non-API) messages.
fn real_model(m: &str) -> bool {
    !m.is_empty() && !m.starts_with('<')
}

// ---------- aggregation ----------

#[derive(Default)]
struct DayCell {
    by_agent: HashMap<String, u64>,
    sessions: HashSet<String>,
    messages: u64,
}

#[derive(Default)]
struct Agg {
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    days: HashMap<NaiveDate, DayCell>,
    seen: HashSet<(String, String)>,
    models: HashMap<String, u64>,
    /// session key → (first, last) message epoch seconds
    spans: HashMap<String, (i64, i64)>,
}

impl Agg {
    fn span(&mut self, key: String, t: i64) {
        let e = self.spans.entry(key).or_insert((t, t));
        e.0 = e.0.min(t);
        e.1 = e.1.max(t);
    }

    fn in_window(&self, d: NaiveDate) -> bool {
        matches!((self.start, self.end), (Some(s), Some(e)) if d >= s && d <= e)
    }

    fn day_entry(&mut self, d: NaiveDate) -> &mut DayCell {
        self.days.entry(d).or_default()
    }

    fn finish(mut self, days: usize) -> Analytics {
        let start = self.start.unwrap_or_else(|| Local::now().date_naive());
        let mut out = Analytics {
            days: Vec::with_capacity(days),
            totals: Totals::default(),
            streaks: Streaks::default(),
            peak_day: None,
            top_agent: None,
            models: self.models.into_iter().collect(),
            longest_session_secs: self
                .spans
                .values()
                .map(|(a, b)| (b - a).max(0) as u64)
                .max()
                .unwrap_or(0),
        };
        let mut active: Vec<bool> = Vec::with_capacity(days);
        let mut agent_totals: BTreeMap<String, u64> = BTreeMap::new();
        for i in 0..days {
            let d = start + Duration::days(i as i64);
            let cell = self.days.remove(&d).unwrap_or_default();
            let mut by_agent = BTreeMap::new();
            let mut total = 0;
            for (agent, t) in cell.by_agent {
                total += t;
                *agent_totals.entry(agent.clone()).or_insert(0) += t;
                by_agent.insert(agent, t);
            }
            if total > 0 {
                out.totals.active_days += 1;
                if out.peak_day.as_ref().map_or(true, |p| total > p.tokens) {
                    out.peak_day = Some(PeakDay {
                        date: d.to_string(),
                        tokens: total,
                    });
                }
            }
            out.totals.tokens += total;
            out.totals.messages += cell.messages;
            out.totals.sessions += cell.sessions.len() as u64;
            active.push(total > 0);
            out.days.push(DayStats {
                date: d.to_string(),
                by_agent,
                sessions: cell.sessions.len() as u64,
                messages: cell.messages,
            });
        }
        // longest run anywhere in the window
        let mut run = 0;
        for &a in &active {
            run = if a { run + 1 } else { 0 };
            out.streaks.longest = out.streaks.longest.max(run);
        }
        // current: count back from today; an idle today still keeps yesterday's run
        let mut i = active.len();
        if i > 0 && !active[i - 1] {
            i -= 1;
        }
        while i > 0 && active[i - 1] {
            out.streaks.current += 1;
            i -= 1;
        }
        // max by tokens; ties broken towards the alphabetically-first agent for determinism
        out.top_agent = agent_totals
            .into_iter()
            .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
            .map(|(agent, tokens)| TopAgent { agent, tokens });
        out
    }
}

fn parse_secs(ts: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(ts).ok().map(|t| t.timestamp())
}

fn parse_day(ts: &str) -> Option<NaiveDate> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|t| t.with_timezone(&Local).date_naive())
}

/// Local midnight of `d` as a `SystemTime` (file-mtime cutoff). The DST-gap fallback
/// treats it as UTC — a skew that only ever shows up in a time zone whose midnight
/// does not exist, which none has.
fn local_midnight(d: NaiveDate) -> SystemTime {
    let naive = d.and_hms_opt(0, 0, 0).expect("00:00:00 is always valid");
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t.into(),
        LocalResult::None => DateTime::from_timestamp(naive.and_utc().timestamp(), 0)
            .map(SystemTime::from)
            .unwrap_or(SystemTime::UNIX_EPOCH),
    }
}

/// Recursively collect `.jsonl` files modified at/after `cutoff`.
fn jsonl_files(dir: &Path, cutoff: SystemTime) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, cutoff, &mut out, 0);
    out
}

fn walk(dir: &Path, cutoff: SystemTime, out: &mut Vec<PathBuf>, depth: u8) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, cutoff, out, depth + 1);
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                if m >= cutoff {
                    out.push(p);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{Cli, Profile, ProfileKind};

    /// RFC3339 stamp for `days_ago` at 12:00 LOCAL time (test is TZ-independent).
    fn ts(days_ago: u64) -> String {
        let d = Local::now().date_naive() - Duration::days(days_ago as i64);
        Local
            .from_local_datetime(&d.and_hms_opt(12, 0, 0).expect("noon is always valid"))
            .single()
            .expect("noon never falls in a DST gap")
            .to_rfc3339()
    }

    /// assistant line: `tokens` input plus a fixed 20 (10 out + 5 + 5 cache) per message.
    fn claude_line(id: &str, req: &str, when: &str, tokens: u64) -> String {
        format!(
            concat!(
                r#"{{"type":"assistant","timestamp":"{when}","sessionId":"s1","uuid":"u-{id}","requestId":"{req}","#,
                r#""message":{{"id":"msg-{id}","role":"assistant","usage":{{"input_tokens":{tok},"output_tokens":10,"#,
                r#""cache_creation_input_tokens":5,"cache_read_input_tokens":5}}}}}}"#
            ),
            when = when,
            id = id,
            req = req,
            tok = tokens,
        )
    }

    fn write(path: &Path, lines: &[String]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, lines.join("\n")).unwrap();
    }

    #[test]
    fn claude_dedupes_and_sums() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects/-home-x/s1.jsonl");
        write(
            &f,
            &[
                // not an assistant line — ignored even though its text says "assistant"
                format!(
                    r#"{{"type":"user","timestamp":"{}","sessionId":"s1","message":{{"role":"user","content":"assistant tool"}}"}}"#,
                    ts(0)
                ),
                claude_line("1", "r1", &ts(0), 100),
                // streamed repeat of the same message + request → deduped
                claude_line("1", "r1", &ts(0), 100),
                // same message id under a NEW request is a real second billable turn
                claude_line("1", "r2", &ts(0), 40),
                claude_line("2", "r2", &ts(0), 10),
            ],
        );
        let a = collect(
            &[Source::Claude {
                dir: d.path().to_path_buf(),
                tag: "claude".into(),
            }],
            7,
        );
        assert_eq!(a.days.len(), 7);
        let today = a.days.last().unwrap();
        assert_eq!(today.by_agent["claude"], 150 + 3 * 20);
        assert_eq!(today.messages, 3);
        assert_eq!(today.sessions, 1);
        assert_eq!(a.totals.tokens, 210);
        assert_eq!(a.totals.messages, 3);
        assert_eq!(a.top_agent.as_ref().unwrap().agent, "claude");
        assert_eq!(a.peak_day.as_ref().unwrap().tokens, 210);
    }

    #[test]
    fn claude_ignores_lines_outside_window() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("projects/p/s.jsonl");
        write(&f, &[claude_line("9", "r9", &ts(20), 5000)]);
        let a = collect(
            &[Source::Claude {
                dir: d.path().to_path_buf(),
                tag: "claude".into(),
            }],
            7,
        );
        assert_eq!(a.totals.tokens, 0);
        assert!(a.days.iter().all(|d| d.by_agent.is_empty()));
        assert!(a.top_agent.is_none());
        assert!(a.peak_day.is_none());
    }

    #[test]
    fn codex_deltas_not_cumulative() {
        let d = tempfile::tempdir().unwrap();
        let mk = |ty: &str, info: &str, when: &str| {
            let mut s = String::from(r#"{"timestamp":""#);
            s.push_str(when);
            s.push_str(r#"","type":"event_msg","payload":{"type":""#);
            s.push_str(ty);
            s.push_str(r#"","info":"#);
            s.push_str(info);
            s.push_str("}}");
            s
        };
        let f = d.path().join("sessions/2026/10/18/rollout-abc.jsonl");
        write(
            &f,
            &[
                r#"{"timestamp":"…","type":"session_meta","payload":{}}"#.into(),
                // cumulative total grows 100 → 300; delta sum must be 300
                mk(
                    "token_count",
                    r#"{"total_token_usage":{"input_tokens":60,"cached_input_tokens":20,"output_tokens":20}}"#,
                    &ts(0),
                ),
                mk(
                    "token_count",
                    r#"{"total_token_usage":{"input_tokens":180,"cached_input_tokens":60,"output_tokens":60}}"#,
                    &ts(0),
                ),
                // repeated snapshot with no growth → +0
                mk(
                    "token_count",
                    r#"{"total_token_usage":{"input_tokens":180,"cached_input_tokens":60,"output_tokens":60}}"#,
                    &ts(0),
                ),
                // no totals at all → use the per-request delta
                mk(
                    "token_count",
                    r#"{"last_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":25}}"#,
                    &ts(0),
                ),
                mk("agent_message", "{}", &ts(0)),
                mk("agent_message", "{}", &ts(0)),
            ],
        );
        let a = collect(
            &[Source::Codex {
                home: d.path().to_path_buf(),
                tag: "codex".into(),
            }],
            7,
        );
        let today = a.days.last().unwrap();
        assert_eq!(today.by_agent.get("codex"), Some(&375)); // 300 cumulative delta + 75 last
        assert_eq!(today.messages, 2);
        assert_eq!(today.sessions, 1);
        assert_eq!(a.totals.sessions, 1);
    }

    #[test]
    fn streaks_active_days_and_multi_source() {
        let cd = tempfile::tempdir().unwrap();
        let xd = tempfile::tempdir().unwrap();
        // pattern over the last 5 days: active, active, idle, active, active(today)
        for (ago, tokens) in [(4u64, 100), (3, 200), (1, 50), (0, 60)] {
            write(
                &cd.path().join(format!("projects/p/s{ago}.jsonl")),
                &[claude_line(&ago.to_string(), "r", &ts(ago), tokens)],
            );
        }
        write(
            &xd.path().join("sessions/2026/10/17/rollout-x.jsonl"),
            &[format!(
                r#"{{"timestamp":"{}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":30,"cached_input_tokens":0,"output_tokens":10}}}}}}}}"#,
                ts(1)
            )],
        );
        let sources = vec![
            Source::Claude {
                dir: cd.path().to_path_buf(),
                tag: "claude".into(),
            },
            Source::Codex {
                home: xd.path().to_path_buf(),
                tag: "codex".into(),
            },
        ];
        let a = collect(&sources, 5);
        assert_eq!(a.days.len(), 5);
        assert_eq!(a.totals.active_days, 4); // 2 days ago idle
        assert_eq!(a.streaks.current, 2); // yesterday + today
        assert_eq!(a.streaks.longest, 2);
        // claude 120+220+70+80 (input + 20 fixed each) + codex 40
        assert_eq!(a.totals.tokens, 530);
        let yesterday = &a.days[3];
        assert_eq!(yesterday.by_agent.get("claude"), Some(&70));
        assert_eq!(yesterday.by_agent.get("codex"), Some(&40));
        assert_eq!(yesterday.sessions, 2);
        assert_eq!(a.top_agent.as_ref().unwrap().agent, "claude");
        assert_eq!(a.peak_day.as_ref().unwrap().tokens, 220); // 200 input + 20 fixed
    }

    #[test]
    fn missing_dirs_give_zero_window() {
        let a = collect(
            &[Source::Claude {
                dir: PathBuf::from("/nonexistent/claude"),
                tag: "c".into(),
            }],
            30,
        );
        assert_eq!(a.days.len(), 30);
        assert!(a
            .days
            .iter()
            .all(|d| d.by_agent.is_empty() && d.sessions == 0));
        assert_eq!(a.totals, Totals::default());
        assert_eq!(a.streaks, Streaks::default());
        assert!(a.peak_day.is_none());
        assert!(a.top_agent.is_none());
    }

    #[test]
    fn default_sources_covers_defaults_and_profiles() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mk = |id: &str, cli: Cli| Profile {
            id: id.into(),
            name: id.into(),
            cli,
            kind: ProfileKind::Subscription,
            color: String::new(),
        };
        // env vars are process-global; pin them off so the assertion is stable
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        std::env::remove_var("CODEX_HOME");
        let s = default_sources(
            home.path(),
            data.path(),
            &[mk("work", Cli::Claude), mk("alt", Cli::Codex)],
        );
        assert_eq!(s.len(), 4);
        let claude_dir = home.path().join(".claude");
        let codex_dir = home.path().join(".codex");
        assert!(matches!(&s[0], Source::Claude { dir, .. } if dir == &claude_dir));
        assert!(matches!(&s[1], Source::Codex { home, .. } if home == &codex_dir));
        assert!(matches!(&s[2], Source::Claude { dir, .. } if dir.ends_with("profiles/work")));
        assert!(matches!(&s[3], Source::Codex { home, .. } if home.ends_with("profiles/alt")));
    }

    #[test]
    fn current_streak_survives_idle_today() {
        let d = tempfile::tempdir().unwrap();
        write(
            &d.path().join("projects/p/a.jsonl"),
            &[claude_line("1", "r", &ts(1), 100)],
        );
        let a = collect(
            &[Source::Claude {
                dir: d.path().to_path_buf(),
                tag: "c".into(),
            }],
            3,
        );
        assert_eq!(a.streaks.current, 1); // yesterday only; today quiet so far
        assert_eq!(a.streaks.longest, 1);
        assert_eq!(a.totals.active_days, 1);
    }

    #[test]
    fn models_longest_session_and_session_usage() {
        let d = tempfile::tempdir().unwrap();
        let line = |id: &str, model: &str, when: String| {
            claude_line(id, &format!("r{id}"), &when, 100).replace(
                r#""role":"assistant""#,
                &format!(r#""role":"assistant","model":"{model}""#),
            )
        };
        let t0 = Local::now() - Duration::hours(3);
        let t1 = t0 + Duration::minutes(90);
        write(
            &d.path().join("projects/-p/s1.jsonl"),
            &[
                line("1", "claude-opus-4", t0.to_rfc3339()),
                line("2", "claude-sonnet-4", t1.to_rfc3339()),
                line("3", "<synthetic>", t1.to_rfc3339()),
            ],
        );
        let src = [Source::Claude {
            dir: d.path().to_path_buf(),
            tag: "claude".into(),
        }];
        let a = collect(&src, 7);
        assert_eq!(a.models["claude-opus-4"], 120);
        assert_eq!(a.models["claude-sonnet-4"], 120);
        assert!(!a.models.contains_key("<synthetic>"));
        assert_eq!(a.longest_session_secs, 90 * 60);

        let su = session_usage(&src, &["s1".into(), "nope".into()]);
        assert_eq!(su.len(), 1);
        assert_eq!(su["s1"].tokens, 360);
        assert_eq!(su["s1"].messages, 3);
        assert_eq!(su["s1"].model.as_deref(), Some("claude-sonnet-4"));
    }
}

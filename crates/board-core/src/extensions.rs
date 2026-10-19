//! Skills & MCP servers of Claude Code / Codex.
//!
//! Reading is done here (pure, filesystem only). *Changing* MCP servers is always done by the
//! CLIs themselves (`claude mcp add|remove`, `codex mcp add|remove`) — this module only builds
//! the argv; the Tauri shell runs it. We never write the CLIs' JSON/TOML config directly.
//! Secret values (env, headers, URL query/userinfo) are never returned — keys only.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::profiles::Cli;
use crate::{Error, Result};

fn bad(msg: impl Into<String>) -> Error {
    Error::Pty(msg.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    User,
    Project,
}

impl Scope {
    fn flag(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project => "project",
        }
    }
}

/// Where a CLI keeps its user-level config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliHome {
    pub cli: Cli,
    /// `~/.claude` / `CLAUDE_CONFIG_DIR` / `~/.codex` / `CODEX_HOME`
    pub dir: PathBuf,
    /// Claude: `~/.claude.json` (default) or `<custom dir>/.claude.json`. Codex: unused.
    pub claude_json: PathBuf,
}

impl CliHome {
    /// `custom` = the profile's isolated config dir (or env override); `home` = user home.
    pub fn resolve(cli: Cli, custom: Option<PathBuf>, home: &Path) -> Self {
        match (cli, custom) {
            (Cli::Claude, Some(d)) => Self {
                cli,
                claude_json: d.join(".claude.json"),
                dir: d,
            },
            (Cli::Claude, None) => Self {
                cli,
                dir: home.join(".claude"),
                claude_json: home.join(".claude.json"),
            },
            (Cli::Codex, c) => {
                let dir = c.unwrap_or_else(|| home.join(".codex"));
                Self {
                    cli,
                    claude_json: PathBuf::new(),
                    dir,
                }
            }
        }
    }
    fn skills_dir(&self) -> PathBuf {
        self.dir.join("skills")
    }
}

// ---------- skills ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub scope: Scope,
    pub path: String,
    /// "skill" (folder with SKILL.md) | "prompt" (Codex `prompts/*.md`, read-only)
    pub kind: &'static str,
}

/// Name rule for NEW skills.
pub fn validate_skill_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(bad(
            "skill name must be 1-64 chars of a-z, 0-9 and '-' (not starting with '-')",
        ))
    }
}

/// Parse `name` / `description` from YAML frontmatter (simple `key: value`, quotes and
/// `>` / `|` block scalars supported). Missing → empty.
pub fn parse_frontmatter(text: &str) -> (String, String) {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return (String::new(), String::new());
    }
    let mut fm: Vec<&str> = Vec::new();
    for l in lines {
        if l.trim() == "---" {
            break;
        }
        fm.push(l);
    }
    let (mut name, mut desc) = (String::new(), String::new());
    let mut i = 0;
    while i < fm.len() {
        let line = fm[i];
        i += 1;
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let mut val = v.trim().to_string();
        if matches!(val.as_str(), ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            let mut parts = Vec::new();
            while i < fm.len() && (fm[i].starts_with(' ') || fm[i].starts_with('\t')) {
                parts.push(fm[i].trim());
                i += 1;
            }
            val = parts.join(" ");
        } else if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
            || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
        {
            val = val[1..val.len() - 1].to_string();
            if line.contains(":") && v.trim().starts_with('"') {
                val = val.replace("\\\"", "\"").replace("\\\\", "\\");
            }
        }
        match k.trim() {
            "name" => name = val,
            "description" => desc = val,
            _ => {}
        }
    }
    (name, desc)
}

fn read_skills_in(dir: &Path, scope: Scope) -> Vec<Skill> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Skill> = rd
        .flatten()
        .filter_map(|e| {
            let folder = e.path();
            let md = folder.join("SKILL.md");
            if !folder.is_dir() || !md.is_file() {
                return None;
            }
            let dirname = e.file_name().to_string_lossy().into_owned();
            let text = fs::read_to_string(&md).unwrap_or_default();
            let (name, description) = parse_frontmatter(&text);
            Some(Skill {
                name: if name.is_empty() { dirname } else { name },
                description,
                scope,
                path: folder.display().to_string(),
                kind: "skill",
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn read_prompts(dir: &Path) -> Vec<Skill> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Skill> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .map(|e| {
            let p = e.path();
            let text = fs::read_to_string(&p).unwrap_or_default();
            let (_, description) = parse_frontmatter(&text);
            Skill {
                name: p
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                description,
                scope: Scope::User,
                path: p.display().to_string(),
                kind: "prompt",
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// User skills of `home` (+ Codex prompts) and, when `project` is given, `<project>/.claude/skills`
/// (Codex: `<project>/.codex/skills`).
pub fn list_skills(home: &CliHome, project: Option<&Path>) -> Vec<Skill> {
    let mut out = read_skills_in(&home.skills_dir(), Scope::User);
    if home.cli == Cli::Codex {
        out.extend(read_prompts(&home.dir.join("prompts")));
    }
    if let Some(p) = project {
        let sub = if home.cli == Cli::Claude {
            ".claude"
        } else {
            ".codex"
        };
        out.extend(read_skills_in(&p.join(sub).join("skills"), Scope::Project));
    }
    out
}

fn skills_root(home: &CliHome, scope: Scope, project: Option<&Path>) -> Result<PathBuf> {
    match scope {
        Scope::User => Ok(home.skills_dir()),
        Scope::Project => {
            let p = project.ok_or_else(|| bad("project scope needs a working folder"))?;
            let sub = if home.cli == Cli::Claude {
                ".claude"
            } else {
                ".codex"
            };
            Ok(p.join(sub).join("skills"))
        }
    }
}

fn yaml_str(s: &str) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    serde_json::to_string(&one).unwrap_or_else(|_| "\"\"".into())
}

/// Write `<skills>/<name>/SKILL.md`. Refuses to overwrite.
pub fn create_skill(
    home: &CliHome,
    scope: Scope,
    project: Option<&Path>,
    name: &str,
    description: &str,
    body: &str,
) -> Result<Skill> {
    validate_skill_name(name)?;
    if description.trim().is_empty() {
        return Err(bad("description is required"));
    }
    let root = skills_root(home, scope, project)?;
    let folder = root.join(name);
    if folder.exists() {
        return Err(bad(format!("skill \"{name}\" already exists")));
    }
    fs::create_dir_all(&folder)?;
    let text = format!(
        "---\nname: {name}\ndescription: {}\n---\n\n{}\n",
        yaml_str(description),
        body.trim()
    );
    fs::write(folder.join("SKILL.md"), text)?;
    Ok(Skill {
        name: name.into(),
        description: description.split_whitespace().collect::<Vec<_>>().join(" "),
        scope,
        path: folder.display().to_string(),
        kind: "skill",
    })
}

/// Remove skill folder `<skills>/<name>`. Guards: `name` is a single path component, the folder
/// must hold a SKILL.md and must resolve inside the skills dir.
pub fn delete_skill(
    home: &CliHome,
    scope: Scope,
    project: Option<&Path>,
    name: &str,
) -> Result<()> {
    let root = skills_root(home, scope, project)?;
    delete_in(&root, name)
}

fn delete_in(root: &Path, name: &str) -> Result<()> {
    let single =
        !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0']);
    if !single {
        return Err(bad("invalid skill name"));
    }
    let folder = root.join(name);
    let meta =
        fs::symlink_metadata(&folder).map_err(|_| bad(format!("skill \"{name}\" not found")))?;
    if meta.file_type().is_symlink() {
        // never follow a link out of the skills dir: drop the link only
        return fs::remove_file(&folder)
            .or_else(|_| fs::remove_dir(&folder))
            .map_err(Into::into);
    }
    let real_root = fs::canonicalize(root)?;
    let real = fs::canonicalize(&folder)?;
    if real.parent() != Some(real_root.as_path()) {
        return Err(bad("refusing to delete outside the skills folder"));
    }
    if !real.join("SKILL.md").is_file() {
        return Err(bad("not a skill folder (no SKILL.md)"));
    }
    fs::remove_dir_all(real)?;
    Ok(())
}

// ---------- MCP: read ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    /// "stdio" | "http" | "sse"
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    /// URL with userinfo / query values masked
    pub url: Option<String>,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    pub scope: Scope,
    pub source: String,
}

/// Hide credentials embedded in a URL: `user:pw@` and query values.
pub fn mask_url(url: &str) -> String {
    let (base, rest) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url, None),
    };
    let mut base = base.to_string();
    if let Some(i) = base.find("://") {
        let after = i + 3;
        let end = base[after..].find('/').map_or(base.len(), |p| after + p);
        if let Some(at) = base[after..end].rfind('@') {
            base.replace_range(after..after + at + 1, "***@");
        }
    }
    match rest {
        Some(q) => {
            let masked: Vec<String> = q
                .split('&')
                .map(|kv| match kv.split_once('=') {
                    Some((k, _)) => format!("{k}=***"),
                    None => kv.to_string(),
                })
                .collect();
            format!("{base}?{}", masked.join("&"))
        }
        None => base,
    }
}

fn keys_of(v: Option<&Value>) -> Vec<String> {
    let mut k: Vec<String> = v
        .and_then(Value::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    k.sort();
    k
}

fn json_servers(doc: &Value, scope: Scope, source: &Path) -> Vec<McpServer> {
    let Some(map) = doc.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out: Vec<McpServer> = map
        .iter()
        .map(|(name, s)| {
            let url = s.get("url").and_then(Value::as_str);
            let transport = match s.get("type").and_then(Value::as_str) {
                Some("http") => "http",
                Some("sse") => "sse",
                Some("stdio") => "stdio",
                _ if url.is_some() => "http",
                _ => "stdio",
            };
            McpServer {
                name: name.clone(),
                transport: transport.into(),
                command: s.get("command").and_then(Value::as_str).map(Into::into),
                args: s
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                url: url.map(mask_url),
                env_keys: keys_of(s.get("env")),
                header_keys: keys_of(s.get("headers")),
                scope,
                source: source.display().to_string(),
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn toml_servers(text: &str, source: &Path) -> Vec<McpServer> {
    let Ok(doc) = text.parse::<toml::Table>() else {
        return Vec::new();
    };
    let Some(map) = doc.get("mcp_servers").and_then(toml::Value::as_table) else {
        return Vec::new();
    };
    let tbl_keys = |v: Option<&toml::Value>| -> Vec<String> {
        let mut k: Vec<String> = v
            .and_then(toml::Value::as_table)
            .map(|t| t.keys().cloned().collect())
            .unwrap_or_default();
        k.sort();
        k
    };
    let mut out: Vec<McpServer> = map
        .iter()
        .filter_map(|(name, s)| {
            let s = s.as_table()?;
            let url = s.get("url").and_then(toml::Value::as_str);
            Some(McpServer {
                name: name.clone(),
                transport: if url.is_some() { "http" } else { "stdio" }.into(),
                command: s
                    .get("command")
                    .and_then(toml::Value::as_str)
                    .map(Into::into),
                args: s
                    .get("args")
                    .and_then(toml::Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                url: url.map(mask_url),
                env_keys: tbl_keys(s.get("env")),
                header_keys: tbl_keys(s.get("http_headers")),
                scope: Scope::User,
                source: source.display().to_string(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// MCP servers visible for `home`: user scope (Claude `.claude.json` top-level `mcpServers`,
/// Codex `config.toml`) plus, for Claude with a `project` folder, `<project>/.mcp.json`.
pub fn list_mcp(home: &CliHome, project: Option<&Path>) -> Vec<McpServer> {
    let mut out = Vec::new();
    match home.cli {
        Cli::Claude => {
            if let Some(doc) = fs::read_to_string(&home.claude_json)
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            {
                out.extend(json_servers(&doc, Scope::User, &home.claude_json));
            }
            if let Some(p) = project {
                let f = p.join(".mcp.json");
                if let Some(doc) = fs::read_to_string(&f)
                    .ok()
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                {
                    out.extend(json_servers(&doc, Scope::Project, &f));
                }
            }
        }
        Cli::Codex => {
            let f = home.dir.join("config.toml");
            if let Ok(t) = fs::read_to_string(&f) {
                out.extend(toml_servers(&t, &f));
            }
        }
    }
    out
}

// ---------- MCP: add / remove argv ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Stdio,
    Http,
    Sse,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMcp {
    pub name: String,
    pub transport: Transport,
    /// stdio: program
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// http / sse
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub scope: Scope,
}

fn valid_server_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && !n.starts_with('-')
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_env_key(k: &str) -> bool {
    let mut c = k.chars();
    c.next()
        .is_some_and(|f| f.is_ascii_alphabetic() || f == '_')
        && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
}

/// argv (after the program name) for adding an MCP server through the CLI.
pub fn add_mcp_argv(cli: Cli, a: &AddMcp) -> Result<Vec<String>> {
    if !valid_server_name(&a.name) {
        return Err(bad(
            "server name must be letters, digits, '-' or '_' (max 64)",
        ));
    }
    for (k, _) in &a.env {
        if !valid_env_key(k) {
            return Err(bad(format!("invalid env variable name \"{k}\"")));
        }
    }
    for (k, v) in &a.headers {
        if k.trim().is_empty() || k.contains(':') || v.contains('\n') {
            return Err(bad(format!("invalid header \"{k}\"")));
        }
    }
    let remote = a.transport != Transport::Stdio;
    if remote {
        let u = a.url.trim();
        if !(u.starts_with("http://") || u.starts_with("https://")) {
            return Err(bad("URL must start with http:// or https://"));
        }
    } else if a.command.trim().is_empty() {
        return Err(bad("command is required"));
    }
    let mut v: Vec<String> = vec!["mcp".into(), "add".into()];
    match cli {
        Cli::Claude => {
            if remote {
                v.push("--transport".into());
                v.push(
                    if a.transport == Transport::Sse {
                        "sse"
                    } else {
                        "http"
                    }
                    .into(),
                );
            }
            v.push("-s".into());
            v.push(a.scope.flag().into());
            for (k, val) in &a.env {
                v.push("-e".into());
                v.push(format!("{k}={val}"));
            }
            for (k, val) in &a.headers {
                v.push("-H".into());
                v.push(format!("{}: {val}", k.trim()));
            }
            v.push(a.name.clone());
            if remote {
                v.push(a.url.trim().into());
            } else {
                v.push("--".into());
                v.push(a.command.trim().into());
                v.extend(a.args.iter().cloned());
            }
        }
        Cli::Codex => {
            if a.transport == Transport::Sse {
                return Err(bad("Codex does not support SSE servers"));
            }
            if !a.headers.is_empty() {
                return Err(bad("Codex does not support custom headers here"));
            }
            if a.scope == Scope::Project {
                return Err(bad("Codex MCP servers are user-wide (no project scope)"));
            }
            v.push(a.name.clone());
            for (k, val) in &a.env {
                v.push("--env".into());
                v.push(format!("{k}={val}"));
            }
            if remote {
                v.push("--url".into());
                v.push(a.url.trim().into());
            } else {
                v.push("--".into());
                v.push(a.command.trim().into());
                v.extend(a.args.iter().cloned());
            }
        }
    }
    Ok(v)
}

/// argv (after the program name) for removing an MCP server through the CLI.
pub fn remove_mcp_argv(cli: Cli, name: &str, scope: Scope) -> Result<Vec<String>> {
    if !valid_server_name(name) {
        return Err(bad("invalid server name"));
    }
    let mut v: Vec<String> = vec!["mcp".into(), "remove".into(), name.into()];
    if cli == Cli::Claude {
        v.push("-s".into());
        v.push(scope.flag().into());
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn claude_home(root: &Path) -> CliHome {
        CliHome::resolve(Cli::Claude, None, root)
    }

    #[test]
    fn frontmatter_variants() {
        let t = "---\nname: pdf-tools\ndescription: \"Edit: PDFs\"\n---\nbody";
        assert_eq!(
            parse_frontmatter(t),
            ("pdf-tools".into(), "Edit: PDFs".into())
        );
        let t = "---\nname: x\ndescription: >\n  line one\n  line two\nother: 1\n---\n";
        assert_eq!(parse_frontmatter(t).1, "line one line two");
        assert_eq!(
            parse_frontmatter("no frontmatter"),
            (String::new(), String::new())
        );
    }

    #[test]
    fn create_list_delete_roundtrip() {
        let d = tempdir().unwrap();
        let proj = tempdir().unwrap();
        let h = claude_home(d.path());
        let s = create_skill(
            &h,
            Scope::User,
            None,
            "my-skill",
            "Does: things\nsafely",
            "# Hi",
        )
        .unwrap();
        assert_eq!(s.description, "Does: things safely");
        create_skill(&h, Scope::Project, Some(proj.path()), "proj-one", "p", "b").unwrap();
        let all = list_skills(&h, Some(proj.path()));
        assert_eq!(all.len(), 2);
        let mine = all.iter().find(|s| s.name == "my-skill").unwrap();
        assert_eq!(mine.description, "Does: things safely");
        assert_eq!(mine.scope, Scope::User);
        assert_eq!(
            all.iter().find(|s| s.name == "proj-one").unwrap().scope,
            Scope::Project
        );
        assert!(create_skill(&h, Scope::User, None, "my-skill", "x", "y").is_err());
        delete_skill(&h, Scope::User, None, "my-skill").unwrap();
        assert_eq!(list_skills(&h, None).len(), 0);
        assert!(proj
            .path()
            .join(".claude/skills/proj-one/SKILL.md")
            .exists());
    }

    #[test]
    fn name_validation_and_traversal_guard() {
        for bad_name in ["", "Up", "a b", "../x", "a/b", "-a", "a_b"] {
            assert!(validate_skill_name(bad_name).is_err(), "{bad_name}");
        }
        assert!(validate_skill_name("ok-1").is_ok());
        let d = tempdir().unwrap();
        let h = claude_home(d.path());
        create_skill(&h, Scope::User, None, "keep", "d", "b").unwrap();
        fs::create_dir_all(d.path().join("victim")).unwrap();
        fs::write(d.path().join("victim/SKILL.md"), "x").unwrap();
        for n in ["../../victim", "..", ".", "a/b", "..\\victim", ""] {
            assert!(delete_skill(&h, Scope::User, None, n).is_err(), "{n}");
        }
        assert!(d.path().join("victim/SKILL.md").exists());
        // folder without SKILL.md is not deleted
        fs::create_dir_all(d.path().join(".claude/skills/plain")).unwrap();
        assert!(delete_skill(&h, Scope::User, None, "plain").is_err());
        assert!(delete_skill(&h, Scope::User, None, "nope").is_err());
        assert!(d.path().join(".claude/skills/keep").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_skill_removes_link_only() {
        let d = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("SKILL.md"), "x").unwrap();
        let h = claude_home(d.path());
        fs::create_dir_all(d.path().join(".claude/skills")).unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join(".claude/skills/lnk")).unwrap();
        delete_skill(&h, Scope::User, None, "lnk").unwrap();
        assert!(outside.path().join("SKILL.md").exists());
    }

    #[test]
    fn codex_prompts_listed() {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join(".codex/prompts")).unwrap();
        fs::write(
            d.path().join(".codex/prompts/review.md"),
            "---\ndescription: Review code\n---\nGo",
        )
        .unwrap();
        let h = CliHome::resolve(Cli::Codex, None, d.path());
        let l = list_skills(&h, None);
        assert_eq!(l.len(), 1);
        assert_eq!(
            (l[0].name.as_str(), l[0].kind, l[0].description.as_str()),
            ("review", "prompt", "Review code")
        );
    }

    #[test]
    fn claude_mcp_user_and_project_masked() {
        let d = tempdir().unwrap();
        let proj = tempdir().unwrap();
        fs::write(
            d.path().join(".claude.json"),
            r#"{"numStartups":3,"mcpServers":{
              "fs":{"type":"stdio","command":"npx","args":["-y","srv"],"env":{"TOKEN":"sekret","A":"b"}},
              "web":{"type":"http","url":"https://x.io/mcp?key=sekret","headers":{"Authorization":"Bearer sekret"}}}}"#,
        )
        .unwrap();
        fs::write(
            proj.path().join(".mcp.json"),
            r#"{"mcpServers":{"p":{"command":"node","args":["s.js"]}}}"#,
        )
        .unwrap();
        let l = list_mcp(&claude_home(d.path()), Some(proj.path()));
        assert_eq!(l.len(), 3);
        let fsrv = l.iter().find(|s| s.name == "fs").unwrap();
        assert_eq!(fsrv.env_keys, ["A", "TOKEN"]);
        assert_eq!(fsrv.args, ["-y", "srv"]);
        let web = l.iter().find(|s| s.name == "web").unwrap();
        assert_eq!(web.transport, "http");
        assert_eq!(web.url.as_deref(), Some("https://x.io/mcp?key=***"));
        assert_eq!(web.header_keys, ["Authorization"]);
        assert_eq!(
            l.iter().find(|s| s.name == "p").unwrap().scope,
            Scope::Project
        );
        let dump = serde_json::to_string(&l).unwrap();
        assert!(!dump.contains("sekret"));
    }

    #[test]
    fn custom_claude_dir_uses_its_json() {
        let d = tempdir().unwrap();
        fs::write(
            d.path().join(".claude.json"),
            r#"{"mcpServers":{"a":{"command":"x"}}}"#,
        )
        .unwrap();
        let h = CliHome::resolve(
            Cli::Claude,
            Some(d.path().to_path_buf()),
            Path::new("/nonexistent"),
        );
        assert_eq!(list_mcp(&h, None).len(), 1);
        assert!(list_mcp(&claude_home(Path::new("/nonexistent")), None).is_empty());
    }

    #[test]
    fn codex_toml_servers() {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join(".codex")).unwrap();
        fs::write(
            d.path().join(".codex/config.toml"),
            "model = \"gpt-5\"\n[mcp_servers.ctx]\ncommand = \"npx\"\nargs = [\"-y\", \"ctx\"]\n[mcp_servers.ctx.env]\nKEY = \"sekret\"\n[mcp_servers.remote]\nurl = \"https://u:pw@h.io/m\"\n[mcp_servers.remote.http_headers]\nX-Key = \"sekret\"\n",
        )
        .unwrap();
        let l = list_mcp(&CliHome::resolve(Cli::Codex, None, d.path()), None);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].name, "ctx");
        assert_eq!(l[0].env_keys, ["KEY"]);
        assert_eq!(l[1].transport, "http");
        assert_eq!(l[1].url.as_deref(), Some("https://***@h.io/m"));
        assert_eq!(l[1].header_keys, ["X-Key"]);
        assert!(!serde_json::to_string(&l).unwrap().contains("sekret"));
    }

    fn add(t: Transport) -> AddMcp {
        AddMcp {
            name: "srv".into(),
            transport: t,
            command: "npx".into(),
            args: vec!["-y".into(), "pkg".into()],
            url: "https://h.io/mcp".into(),
            env: vec![("K".into(), "v=1".into())],
            headers: vec![("Authorization".into(), "Bearer t".into())],
            scope: Scope::User,
        }
    }

    #[test]
    fn claude_add_argv() {
        let v = add_mcp_argv(Cli::Claude, &add(Transport::Stdio)).unwrap();
        assert_eq!(
            v,
            [
                "mcp",
                "add",
                "-s",
                "user",
                "-e",
                "K=v=1",
                "-H",
                "Authorization: Bearer t",
                "srv",
                "--",
                "npx",
                "-y",
                "pkg"
            ]
        );
        let v = add_mcp_argv(Cli::Claude, &add(Transport::Http)).unwrap();
        assert_eq!(&v[..5], ["mcp", "add", "--transport", "http", "-s"]);
        assert_eq!(&v[v.len() - 2..], ["srv", "https://h.io/mcp"]);
        let mut p = add(Transport::Sse);
        p.scope = Scope::Project;
        let v = add_mcp_argv(Cli::Claude, &p).unwrap();
        assert!(v.windows(2).any(|w| w == ["--transport", "sse"]));
        assert!(v.windows(2).any(|w| w == ["-s", "project"]));
    }

    #[test]
    fn codex_add_argv() {
        let mut a = add(Transport::Stdio);
        a.headers.clear();
        let v = add_mcp_argv(Cli::Codex, &a).unwrap();
        assert_eq!(
            v,
            ["mcp", "add", "srv", "--env", "K=v=1", "--", "npx", "-y", "pkg"]
        );
        a.transport = Transport::Http;
        let v = add_mcp_argv(Cli::Codex, &a).unwrap();
        assert_eq!(&v[v.len() - 2..], ["--url", "https://h.io/mcp"]);
        assert!(add_mcp_argv(Cli::Codex, &add(Transport::Http)).is_err()); // headers
        a.transport = Transport::Sse;
        assert!(add_mcp_argv(Cli::Codex, &a).is_err());
    }

    #[test]
    fn add_validation() {
        let mut a = add(Transport::Stdio);
        a.name = "bad name".into();
        assert!(add_mcp_argv(Cli::Claude, &a).is_err());
        let mut a = add(Transport::Stdio);
        a.env = vec![("1BAD".into(), "x".into())];
        assert!(add_mcp_argv(Cli::Claude, &a).is_err());
        let mut a = add(Transport::Stdio);
        a.command = " ".into();
        assert!(add_mcp_argv(Cli::Claude, &a).is_err());
        let mut a = add(Transport::Http);
        a.url = "ftp://x".into();
        assert!(add_mcp_argv(Cli::Claude, &a).is_err());
    }

    #[test]
    fn remove_argv() {
        assert_eq!(
            remove_mcp_argv(Cli::Claude, "srv", Scope::Project).unwrap(),
            ["mcp", "remove", "srv", "-s", "project"]
        );
        assert_eq!(
            remove_mcp_argv(Cli::Codex, "srv", Scope::User).unwrap(),
            ["mcp", "remove", "srv"]
        );
        assert!(remove_mcp_argv(Cli::Claude, "-rf", Scope::User).is_err()); // would parse as a flag
        assert!(remove_mcp_argv(Cli::Claude, "a b", Scope::User).is_err());
    }
}

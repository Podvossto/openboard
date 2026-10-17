use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("pty: {0}")]
    Pty(String),
    #[error("console not found: {0}")]
    ConsoleNotFound(String),
    #[error("program not found on PATH: {0}")]
    ProgramNotFound(String),
    #[error("unsupported workspace version {found} (max supported {max})")]
    UnsupportedVersion { found: u32, max: u32 },
    #[error("hook: {0}")]
    Hook(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

//! Agent Board core.
//!
//! Everything here is UI-agnostic so it can be unit-tested headless on CI.
//! The Tauri shell (`src-tauri`) only wires these pieces to IPC commands.

pub mod agents;
pub mod analytics;
pub mod ansi;
pub mod browser;
pub mod catalog;
pub mod error;
pub mod files;
pub mod git;
pub mod hooks;
pub mod mcp;
pub mod model;
pub mod persist;
pub mod profiles;
pub mod pty;
pub mod router;
pub mod scrollback;
pub mod settings;
pub mod status;
pub mod usage;

pub use error::{Error, Result};

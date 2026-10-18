//! Agent Board core.
//!
//! Everything here is UI-agnostic so it can be unit-tested headless on CI.
//! The Tauri shell (`src-tauri`) only wires these pieces to IPC commands.

pub mod agents;
pub mod ansi;
pub mod error;
pub mod hooks;
pub mod model;
pub mod persist;
pub mod pty;
pub mod scrollback;
pub mod settings;
pub mod status;
pub mod usage;

pub use error::{Error, Result};

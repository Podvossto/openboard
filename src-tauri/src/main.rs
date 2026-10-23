// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `openboard hook` is invoked by agent CLIs (Claude Code hooks) — forward and exit
    // without starting the GUI.
    if std::env::args().nth(1).as_deref() == Some("hook") {
        let _ = board_core::hooks::run_client();
        return;
    }
    openboard_lib::run();
}

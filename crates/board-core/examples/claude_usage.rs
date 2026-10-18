//! Manual check: cargo run -p board-core --example claude_usage
fn main() {
    let home = board_core::settings::home_dir().unwrap_or_default();
    let u = board_core::usage::fetch_claude(&home);
    println!("{}", serde_json::to_string(&u).unwrap());
}

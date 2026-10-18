//! Manual check: ZK=<key> cargo run -p board-core --example zai
fn main() {
    let key = std::env::var("ZK").unwrap_or_default();
    let u = board_core::usage::fetch_zai(key.trim());
    println!("{}", serde_json::to_string(&u).unwrap());
}

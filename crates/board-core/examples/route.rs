//! Manual check of the dispatcher against a real model:
//!   cargo run -q -p board-core --example route -- prompt "pass this task to codex" | claude -p | cargo run -q -p board-core --example route -- parse
use board_core::router::{parse_plan, router_prompt, RouterConsole};
use std::io::Read;

fn board() -> Vec<RouterConsole> {
    let c = |id: &str, t: &str, a: &str, s: &str, g: Option<&str>, f: bool| RouterConsole {
        id: id.into(),
        title: t.into(),
        agent: a.into(),
        status: s.into(),
        group: g.map(Into::into),
        focused: f,
    };
    vec![
        c("1", "api", "claude", "resting", None, true),
        c("2", "web", "claude", "working", Some("frontend"), false),
        c("3", "reviewer", "codex", "resting", None, false),
        c("4", "tester-1", "shell", "resting", Some("testers"), false),
        c("5", "tester-2", "shell", "resting", Some("testers"), false),
        c("6", "old", "claude", "exited", None, false),
    ]
}

fn main() {
    let mut a = std::env::args().skip(1);
    match a.next().as_deref() {
        Some("prompt") => print!("{}", router_prompt(&a.next().unwrap_or_default(), &board())),
        Some("parse") => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).unwrap();
            match parse_plan(&s, &board()) {
                Ok(p) => println!("{}", serde_json::to_string(&p).unwrap()),
                Err(e) => println!("ERR {e} <- {s}"),
            }
        }
        Some("goal") => {
            let goal = a.next().unwrap_or_default();
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).unwrap();
            print!("{}", board_core::router::goal_prompt(&goal, "api", &s));
        }
        Some("verdict") => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s).unwrap();
            match board_core::router::parse_goal(&s) {
                Ok(v) => println!("{}", serde_json::to_string(&v).unwrap()),
                Err(e) => println!("ERR {e} <- {s}"),
            }
        }
        _ => eprintln!("usage: route prompt <text> | route parse | route goal <goal> < transcript | route verdict"),
    }
}

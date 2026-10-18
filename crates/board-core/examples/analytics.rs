//! Usage analytics against the REAL logs on this machine:
//!   cargo run -q -p board-core --example analytics -- [days]
//! Prints per-agent totals, streaks, peak day and the last few days.
use board_core::analytics::{collect, default_sources};

fn main() {
    let days: usize = std::env::args()
        .nth(1)
        .and_then(|d| d.parse().ok())
        .unwrap_or(30);
    let home = board_core::settings::home_dir().unwrap_or_else(|| ".".into());
    let sources = default_sources(&home, std::path::Path::new(""), &[]);
    for s in &sources {
        match s {
            board_core::analytics::Source::Claude { dir, .. } => {
                println!("scanning claude: {}", dir.display())
            }
            board_core::analytics::Source::Codex { home, .. } => {
                println!("scanning codex:  {}", home.display())
            }
        }
    }
    let t0 = std::time::Instant::now();
    let a = collect(&sources, days);
    println!("(scanned in {:?})\n", t0.elapsed());
    println!("Last {days} days:");
    println!("  total tokens : {}", a.totals.tokens);
    println!("  sessions     : {}", a.totals.sessions);
    println!("  messages     : {}", a.totals.messages);
    println!("  active days  : {}", a.totals.active_days);
    println!(
        "  streaks      : current {} · longest {}",
        a.streaks.current, a.streaks.longest
    );
    if let Some(p) = &a.peak_day {
        println!("  peak day     : {} ({})", p.date, p.tokens);
    }
    if let Some(t) = &a.top_agent {
        println!("  top agent    : {} ({})", t.agent, t.tokens);
    }
    println!("\nper day (last 10):");
    for d in a.days.iter().rev().take(10) {
        let agents = if d.by_agent.is_empty() {
            "—".to_string()
        } else {
            d.by_agent
                .iter()
                .map(|(k, v)| format!("{k} {v}"))
                .collect::<Vec<_>>()
                .join(" · ")
        };
        println!(
            "  {}  {:>10}  sessions {:>2}  msgs {:>3}  {agents}",
            d.date,
            day_total(d),
            d.sessions,
            d.messages
        );
    }
}

fn day_total(d: &board_core::analytics::DayStats) -> u64 {
    d.by_agent.values().sum()
}

//! Real PTY round-trip (ConPTY on the Windows CI runner, openpty on Linux).

use std::sync::Arc;
use std::time::{Duration, Instant};

use board_core::pty::{PtyEvents, PtyManager, SpawnRequest};
use board_core::status::Status;
use parking_lot::Mutex;

#[derive(Default)]
struct Rec {
    out: Mutex<Vec<u8>>,
    statuses: Mutex<Vec<Status>>,
    exit: Mutex<Option<Option<u32>>>,
}

impl PtyEvents for Rec {
    fn output(&self, _: &str, d: &[u8]) {
        self.out.lock().extend_from_slice(d);
    }
    fn status(&self, _: &str, s: Status) {
        self.statuses.lock().push(s);
    }
    fn exited(&self, _: &str, c: Option<u32>) {
        *self.exit.lock() = Some(c);
    }
}

fn wait_until(mut f: impl FnMut() -> bool) -> bool {
    let end = Instant::now() + Duration::from_secs(15);
    while Instant::now() < end {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

fn shell() -> (std::path::PathBuf, Vec<String>) {
    if cfg!(windows) {
        (
            board_core::agents::resolve("cmd").unwrap(),
            vec!["/Q".into(), "/K".into()],
        )
    } else {
        ("/bin/sh".into(), vec![])
    }
}

#[test]
fn echo_roundtrip_and_exit() {
    let rec = Arc::new(Rec::default());
    let m = PtyManager::new(rec.clone());
    let (program, args) = shell();
    m.spawn(SpawnRequest {
        id: "t1".into(),
        program,
        args,
        cwd: std::env::temp_dir(),
        env: vec![("AB_MARK".into(), "ok".into())],
        cols: 100,
        rows: 30,
        hooks: false,
    })
    .unwrap();
    assert!(m.is_running("t1"));
    m.resize("t1", 120, 40).unwrap();

    let line = if cfg!(windows) {
        "echo marker-%AB_MARK%-42\r\n"
    } else {
        "echo marker-$AB_MARK-42\n"
    };
    m.write("t1", line.as_bytes()).unwrap();
    assert!(
        wait_until(|| String::from_utf8_lossy(&rec.out.lock()).contains("marker-ok-42")),
        "output: {}",
        String::from_utf8_lossy(&rec.out.lock())
    );
    let sb = m.scrollback("t1").unwrap();
    assert!(String::from_utf8_lossy(&sb).contains("marker-ok-42"));

    m.write(
        "t1",
        if cfg!(windows) {
            b"exit 3\r\n"
        } else {
            b"exit 3\n"
        },
    )
    .unwrap();
    assert!(wait_until(|| rec.exit.lock().is_some()), "no exit");
    assert_eq!(*rec.exit.lock(), Some(Some(3)));
    assert!(!m.is_running("t1"));
    assert_eq!(rec.statuses.lock().last(), Some(&Status::Exited));
}

#[test]
fn kill_reports_exit_and_frees_session() {
    let rec = Arc::new(Rec::default());
    let m = PtyManager::new(rec.clone());
    let (program, args) = shell();
    m.spawn(SpawnRequest {
        id: "k1".into(),
        program,
        args,
        cwd: std::env::temp_dir(),
        env: vec![],
        cols: 80,
        rows: 24,
        hooks: false,
    })
    .unwrap();
    m.kill("k1").unwrap();
    assert!(
        wait_until(|| rec.exit.lock().is_some()),
        "no exit after kill"
    );
    assert!(!m.is_running("k1"));
}

#[test]
fn unknown_console_errors() {
    let m = PtyManager::new(Arc::new(Rec::default()));
    assert!(m.write("nope", b"x").is_err());
}

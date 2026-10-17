# Agent Board

Windows desktop app: a pan/zoom board where every tile is a **real terminal** running your
AI coding CLIs (Claude Code, Codex, any shell). Each console shows live status —
**working / resting / needs you** — and can be resumed after you restart the app.

CLIs run unmodified in a real PTY (ConPTY), using their own login/subscription. Nothing leaves your machine.

## Architecture

```
agent-board/
├─ crates/board-core/        # Rust, UI-agnostic, fully tested
│  ├─ pty.rs                 #   PTY sessions (portable-pty → ConPTY), scrollback, attach
│  ├─ status.rs              #   status state machine (hooks + output heuristic)
│  ├─ hooks.rs               #   loopback hook server + `agent-board hook` client
│  ├─ agents.rs              #   launch/resume specs per CLI
│  ├─ persist.rs             #   atomic JSON workspace + rotating backups + migrations
│  └─ tests/pty_integration.rs
├─ src-tauri/                # Tauri 2 shell: IPC commands, event bridge, app state
└─ src/                      # React 19 + TypeScript (strict)
   ├─ app/                   #   App root
   ├─ features/board/        #   React Flow canvas, toolbar, autosave
   ├─ features/console/      #   console node, xterm.js view, runtime listeners
   ├─ store/                 #   zustand store (+ tests)
   └─ lib/                   #   typed IPC, shared types
```

**Data flow**
- Keystrokes: xterm → `write_console` → PTY.
- Output: PTY reader thread → scrollback ring + per-console Tauri `Channel` (binary, ordered).
  Re-attach after a webview reload replays scrollback with no gap (snapshot + subscribe under one lock).
- Status: Claude Code is launched with `--settings <app file>` whose hooks call
  `agent-board.exe hook` → token-protected `127.0.0.1` server → state machine → UI.
  Your own `~/.claude/settings.json` is never touched. Other CLIs use an output/input heuristic.
- Resume: Claude consoles get a pre-assigned `--session-id`; reopening offers `--resume <id>`
  (the id is kept up to date from hook payloads). Codex uses `codex resume --last`.
- Persistence: `%APPDATA%\site.podvosto.agentboard\workspace.json` — atomic write, 5 backups,
  auto-recovery from backup if the file is corrupt.

## Develop

Prereqs (Windows): Rust stable (MSVC), Node 22+, WebView2 (preinstalled on Win 10/11).

```powershell
npm ci
npm run tauri dev          # run the app
npm run check              # typecheck + lint + vitest
cargo test -p board-core   # core + real PTY integration tests
npm run tauri build        # NSIS + MSI installers in target/release/bundle/
```

## Status
MVP phase 1 — see `SOT.md`. Scope in `PROJECT.md`.

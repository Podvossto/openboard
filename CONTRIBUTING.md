# Contributing

Bug reports and pull requests are welcome.

## Setup

Requirements: Node 22+, Rust stable (see `rust-toolchain.toml`). On Windows, WebView2 is
preinstalled on 10/11. On Linux you need the Tauri system packages
(`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev`)
to build the desktop shell; the `board-core` crate and the web UI need nothing extra.

```bash
npm ci
npm run check                 # typecheck + eslint + vitest
cargo fmt --all --check
cargo clippy -p board-core -- -D warnings
cargo test -p board-core
```

CI runs the same commands, so a green local run should be a green PR.

## Working on the UI without Tauri

`npx vite --mode mock` serves the UI with a fake backend (`src/dev/tauri-mock.ts`), so you
can iterate in a normal browser. `scripts/ui-smoke.py` is a Playwright smoke test against it.

## Pull requests

- Keep them focused; one change per PR.
- Add or update tests next to the code you touch (`*.test.ts` for the UI, `#[cfg(test)]` or
  `crates/board-core/tests` for Rust).
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`...).
- Business logic belongs in `crates/board-core`; `src-tauri` should stay a thin glue layer.

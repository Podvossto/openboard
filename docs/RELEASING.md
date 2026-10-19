# Releasing Agent Board (in-app updates)

Installed apps check `http://updates.example.invalid:8740/agent-board/latest.json` (private network only)
on start and every 6 hours, ask the user, then download → verify the minisign signature →
install → restart. Boards/settings/accounts live in the app data dir and are untouched.

## Cut a release

```bash
python3 scripts/bump-version.py patch        # or minor / major / 0.3.0 — updates Cargo.toml, tauri.conf.json, package(-lock).json
git commit -am "release: v$(node -p "require('./src-tauri/tauri.conf.json').version")"
git tag -a vX.Y.Z -m "- what changed (shown in the update dialog)"
git push && git push origin vX.Y.Z
```

The tag pipeline runs **only on our self-hosted runner** (`hermes-linux`, no SaaS minutes):
`windows-release` builds the signed NSIS installer, writes `latest.json`
(`scripts/make-latest-json.py`) and copies both into `/releases`
(= `~/agent-board-releases/agent-board` on the server). The manifest is written last
(atomic rename), so clients never see a manifest whose installer is missing.
The tag message becomes the release notes. A tag that does not match the app version fails the job.

## Pieces on the server (outside the repo)

- Signing key: `~/.agent-board-signing/` (mode 700) — `agent-board.key`, `password`, `.pub`.
  **Back it up.** Losing it means installed apps can never accept a new update (they would
  need a manual reinstall with a new public key).
- GitLab CI variables (protected + masked): `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  Tags `v*` are protected (Maintainers) so only protected pipelines can sign.
- Runner volume: `~/.gitlab-runner/config.toml` → `volumes = ["/cache", "/srv/releases/openboard:/releases:rw"]`
- Update server: `systemctl --user status agent-board-updates` — `python3 -m http.server 8740`
  bound to the private network IP only, serving `~/agent-board-releases`.

## Notes

- Transport is plain HTTP inside the private network tunnel (WireGuard-encrypted);
  `dangerousInsecureTransportProtocol` is set for that reason. Integrity comes from the
  signature: a tampered installer is rejected.
- The first install with updater support (0.1.0 → later) must still be installed by hand once.
- Roll back: put the previous installer + its `latest.json` back — but the updater only
  installs a *higher* version, so a rollback is a new patch release.

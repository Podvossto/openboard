# Releasing OpenBoard

Releases are Windows NSIS installers built by GitHub Actions and attached to a GitHub Release.
They are unsigned, so Windows SmartScreen will warn on first run. There is no in-app updater;
users download the new installer from the Releases page.

## Cut a release

```bash
python3 scripts/bump-version.py patch   # or minor / major / 0.3.0
# updates Cargo.toml, src-tauri/tauri.conf.json, package.json and package-lock.json
git commit -am "release: v$(node -p "require('./src-tauri/tauri.conf.json').version")"
git tag vX.Y.Z
git push && git push origin vX.Y.Z
```

Pushing a `v*` tag runs `.github/workflows/release.yml` on `windows-latest`:

1. `npm ci` and the pinned Windows native packages (`scripts/ci-win-native-deps.ps1`).
2. Checks that the tag matches the version in `tauri.conf.json` (the job fails if not).
3. `npx tauri build --bundles nsis`.
4. Creates the GitHub Release with generated notes and attaches `*-setup.exe`.

The same build runs on every push and pull request in `ci.yml` and is kept as a workflow artifact,
so you can try the installer before tagging.

## Building by hand

```powershell
npm ci
npx tauri build --bundles nsis
# target\release\bundle\nsis\OpenBoard_<version>_x64-setup.exe
```

## Notes

- The installer installs per user (no admin prompt).
- Settings and boards live in the app data directory and are kept across reinstalls.
- To roll back, publish a new patch release; there is no downgrade path built in.
- Code signing is not set up. If you add a certificate later, sign the exe in the release
  workflow before the upload step.

#!/usr/bin/env python3
"""Bump the app version everywhere it lives (Cargo workspace, tauri.conf.json, package.json).

usage: scripts/bump-version.py 0.2.0      # explicit
       scripts/bump-version.py patch|minor|major
Prints the new version. Then: git commit -am "release: vX.Y.Z" && git tag vX.Y.Z && git push --tags
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def current() -> str:
    m = re.search(r'\[workspace\.package\][^\[]*?version\s*=\s*"([^"]+)"', (ROOT / "Cargo.toml").read_text(), re.S)
    if not m:
        sys.exit("workspace version not found in Cargo.toml")
    return m.group(1)


def next_version(cur: str, arg: str) -> str:
    if SEMVER.match(arg):
        return arg
    m = SEMVER.match(cur)
    if not m:
        sys.exit(f"current version {cur!r} is not X.Y.Z")
    a, b, c = map(int, m.groups())
    if arg == "major":
        return f"{a + 1}.0.0"
    if arg == "minor":
        return f"{a}.{b + 1}.0"
    if arg == "patch":
        return f"{a}.{b}.{c + 1}"
    sys.exit(f"bad argument {arg!r}: use X.Y.Z, patch, minor or major")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cur = current()
    new = next_version(cur, sys.argv[1])

    cargo = ROOT / "Cargo.toml"
    text = cargo.read_text()
    text = re.sub(r'(\[workspace\.package\][^\[]*?version\s*=\s*")[^"]+(")', rf"\g<1>{new}\g<2>", text, count=1, flags=re.S)
    cargo.write_text(text)

    for name in ("src-tauri/tauri.conf.json", "package.json"):
        p = ROOT / name
        raw = p.read_text()
        # targeted replace keeps the file's formatting intact
        raw2, n = re.subn(r'("version"\s*:\s*")[^"]+(")', rf"\g<1>{new}\g<2>", raw, count=1)
        if n != 1:
            sys.exit(f"version field not found in {name}")
        json.loads(raw2)
        p.write_text(raw2)

    lock = ROOT / "package-lock.json"
    if lock.exists():
        data = json.loads(lock.read_text())
        data["version"] = new
        if "" in data.get("packages", {}):
            data["packages"][""]["version"] = new
        lock.write_text(json.dumps(data, indent=2) + "\n")

    print(new)


if __name__ == "__main__":
    main()

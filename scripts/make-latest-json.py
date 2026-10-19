#!/usr/bin/env python3
"""Write the updater manifest (latest.json) for a signed NSIS installer.

usage: scripts/make-latest-json.py <installer.exe> <base-url> [notes-file] > latest.json
The .sig next to the installer (from TAURI_SIGNING_PRIVATE_KEY at build time) is embedded.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def manifest(exe: Path, base_url: str, version: str, notes: str) -> dict:
    sig = exe.with_name(exe.name + ".sig")
    if not sig.exists():
        sys.exit(f"missing signature {sig} — was TAURI_SIGNING_PRIVATE_KEY set for the build?")
    return {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": sig.read_text().strip(),
                "url": f"{base_url.rstrip('/')}/{quote(exe.name)}",
            }
        },
    }


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    exe = Path(sys.argv[1])
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / "src-tauri/tauri.conf.json").read_text())["version"]
    if version not in exe.name:
        sys.exit(f"installer {exe.name} does not match app version {version}")
    notes = Path(sys.argv[3]).read_text().strip() if len(sys.argv) == 4 else ""
    print(json.dumps(manifest(exe, sys.argv[2], version, notes), indent=2))


if __name__ == "__main__":
    main()

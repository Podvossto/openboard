#!/usr/bin/env bash
# usage: scripts/ui-all.sh <port> [tests...] — run Playwright UI suites against a running mock vite
# (start it first: npx vite --mode mock --port <port> --strictPort)
PORT=$1; shift
cd "$(dirname "$0")/.."
PY=${PY:-$HOME/9r-venv/bin/python}
TESTS=${*:-ui-phase8 ui-smoke-v2 ui-dock ui-tiles ui-loops ui-phase4 ui-motion ui-code ui-webcal ui-usage ui-resume-git}
for t in $TESTS; do
  timeout 100 "$PY" "scripts/$t.py" "http://localhost:$PORT/" > "/tmp/$t.out" 2>&1
  rc=$?
  echo "$t: exit=$rc pass=$(grep -c '^PASS' "/tmp/$t.out") $(grep -E '^FAIL|waiting for' "/tmp/$t.out" | head -3 | tr '\n' ' ')"
done

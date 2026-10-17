#!/usr/bin/env bash
# Wait for the latest pipeline on a branch and print job results (+ tail of failed logs).
# usage: scripts/ci-status.sh [branch] [max_wait_seconds]
set -euo pipefail
BR=${1:-dev}; MAX=${2:-1500}; PID=87762334
TOK=$(grep gitlab.com ~/.git-credentials | sed -E 's#https://[^:]+:([^@]+)@.*#\1#')
api() { curl -s -H "PRIVATE-TOKEN: $TOK" "https://gitlab.com/api/v4/projects/$PID/$1"; }
SHA=$(git rev-parse HEAD)
end=$((SECONDS + MAX))
while :; do
  P=$(api "pipelines?ref=$BR&sha=$SHA&per_page=1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')
  if [ -n "$P" ]; then
    ST=$(api "pipelines/$P" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
    case $ST in success|failed|canceled|skipped) break;; esac
  fi
  [ $SECONDS -ge $end ] && { echo "TIMEOUT pipeline=$P status=${ST:-none}"; break; }
  sleep 30
done
echo "pipeline $P ($SHA) => ${ST:-none}"
api "pipelines/$P/jobs?per_page=50" | python3 -c '
import json,sys
for j in json.load(sys.stdin): print(j["id"], j["name"], "=", j["status"], j.get("failure_reason") or "")' | tee /tmp/ab-jobs.txt
for J in $(awk '$4=="failed"{print $1}' /tmp/ab-jobs.txt); do
  echo "===== log tail $J"; api "jobs/$J/trace" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | grep -vE '^\s*$' | tail -60
done

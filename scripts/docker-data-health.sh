#!/usr/bin/env bash
# Data-folder cases against a built image, including the Phase 2 heartbeat,
# newer schemaVersion, and doctor --repair / --restore checks.
set -euo pipefail

IMAGE="${1:-nerdgram1337:ci}"
ROOT="$(mktemp -d)"
trap 'docker rm -f ng-data-health ng-data-health-b >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT

# The process listens on 8787. A Host port of the published host port is 403.
LISTEN_HOST="127.0.0.1:8787"

# Print status and body. Return 1 on a non-2xx or a curl error.
# Extra curl args follow the URL. Pass quiet as the first argument to stay silent.
http_get() {
  local quiet=""
  if [[ "${1:-}" == "quiet" ]]; then
    quiet="quiet"
    shift
  fi
  local url="$1"
  shift
  local out code
  out="$(mktemp)"
  code="$(curl -sS -o "$out" -w '%{http_code}' -H "Host: ${LISTEN_HOST}" "$@" "$url" 2>"$out.err" || true)"
  if [[ ! "$code" =~ ^2 ]]; then
    if [[ "$quiet" != "quiet" ]]; then
      echo "HTTP ${code:-curl-failed} ${url}" >&2
      if [[ -s "$out.err" ]]; then
        cat "$out.err" >&2
      fi
      cat "$out" >&2 || true
    fi
    rm -f "$out" "$out.err"
    return 1
  fi
  cat "$out"
  rm -f "$out" "$out.err"
}

wait_url() {
  local port="$1"
  local name="$2"
  local url="http://127.0.0.1:${port}/api/health"
  local i
  for i in $(seq 1 40); do
    if http_get quiet "$url" >/dev/null; then
      return 0
    fi
    if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
      echo "container $name exited" >&2
      docker logs "$name" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  echo "timed out waiting for $url (Host ${LISTEN_HOST})" >&2
  http_get "$url" >&2 || true
  docker logs "$name" >&2 || true
  return 1
}

run_case() {
  local name="$1"
  local port="$2"
  shift 2
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" "$@" "$IMAGE" >/dev/null
  wait_url "$port" "$name" || return 1
  local body
  body="$(http_get "http://127.0.0.1:${port}/api/health")" || return 1
  python3 - "$body" << 'PY' || return 1
import json, sys
body = json.loads(sys.argv[1])
assert body["ok"] is True, body
assert "data" in body, body
assert body["data"]["status"] in {"ok", "warn", "degraded"}
PY
  echo "$body"
}

echo "case 1: empty updates.json"
vol1="$(docker volume create)"
docker run --rm -v "$vol1":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && : > /data/.meta/updates.json && echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18781 -p 127.0.0.1:18781:8787 -v "$vol1":/data)" || exit 1
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert any(issue.get("file") == "updates.json" for issue in body["data"]["issues"]), body
PY
http_get "http://127.0.0.1:18781/api/version" | python3 -c 'import json,sys; body=json.load(sys.stdin); assert body["version"]'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol1" >/dev/null

echo "case 2: truncated tokens and presets"
vol2="$(docker volume create)"
docker run --rm -v "$vol2":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && printf "{" > /data/.meta/api-tokens.json && printf "{" > /data/.meta/style-presets.json'
body="$(run_case ng-data-health 18782 -p 127.0.0.1:18782:8787 -v "$vol2":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
files = {issue.get("file") for issue in body["data"]["issues"]}
assert "api-tokens.json" in files and "style-presets.json" in files, body
PY
code="$(curl -s -o /tmp/ng-v1.json -w '%{http_code}' -H 'Authorization: Bearer ng_not-a-real-token' -H "Host: ${LISTEN_HOST}" 'http://127.0.0.1:18782/api/v1/history?path=Welcome.mmd' || true)"
if [[ "$code" != "401" ]]; then
  echo "HTTP ${code} /api/v1/history" >&2
  cat /tmp/ng-v1.json >&2 || true
  exit 1
fi
code="$(curl -s -o /tmp/ng-mcp.json -w '%{http_code}' -H 'Authorization: Bearer ng_not-a-real-token' -H "Host: ${LISTEN_HOST}" -H 'content-type: application/json' -d '{}' 'http://127.0.0.1:18782/mcp' || true)"
if [[ "$code" == "500" || "$code" == "200" ]]; then
  echo "HTTP ${code} /mcp" >&2
  cat /tmp/ng-mcp.json >&2 || true
  exit 1
fi
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol2" >/dev/null

echo "case 3: root-owned mode 600 updates.json"
vol3="$(docker volume create)"
docker run --rm --user 0 -v "$vol3":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && echo "{}" > /data/.meta/updates.json && chown root:root /data/.meta/updates.json && chmod 600 /data/.meta/updates.json && chown -R 1001:1001 /data && chown root:root /data/.meta/updates.json && chmod 600 /data/.meta/updates.json'
body="$(run_case ng-data-health 18783 -p 127.0.0.1:18783:8787 -v "$vol3":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["ok"] is True
assert body["data"]["status"] in {"warn", "degraded"}
PY
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol3" >/dev/null

echo "case 4: iCloud placeholder"
vol4="$(docker volume create)"
docker run --rm -v "$vol4":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data && : > /data/.Foo.mmd.icloud && echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18784 -p 127.0.0.1:18784:8787 -v "$vol4":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["data"]["syncFolder"] is True, body
PY
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol4" >/dev/null

echo "case 5: conflict copy"
vol5="$(docker volume create)"
docker run --rm -v "$vol5":/data --entrypoint sh "$IMAGE" -c 'echo "flowchart LR" > "/data/Welcome 2.mmd"'
body="$(run_case ng-data-health 18785 -p 127.0.0.1:18785:8787 -v "$vol5":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["data"]["syncFolder"] is True, body
PY
docker exec ng-data-health sh -c 'test -f "/data/Welcome 2.mmd"'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol5" >/dev/null

echo "case 6: orphaned temp"
vol6="$(docker volume create)"
docker run --rm -v "$vol6":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && echo stale > /data/.meta/.ng-99-dead.tmp && touch -d "20 minutes ago" /data/.meta/.ng-99-dead.tmp && echo "flowchart LR" > /data/Welcome.mmd'
run_case ng-data-health 18786 -p 127.0.0.1:18786:8787 -v "$vol6":/data >/dev/null
docker exec ng-data-health sh -c 'test ! -e /data/.meta/.ng-99-dead.tmp && test -f /data/Welcome.mmd'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol6" >/dev/null

echo "case 8: read-only data mount"
vol8="$(docker volume create)"
docker run --rm -v "$vol8":/data --entrypoint sh "$IMAGE" -c 'echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18788 -p 127.0.0.1:18788:8787 -v "$vol8":/data:ro)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["ok"] is True
assert body["data"]["status"] == "degraded", body
assert body["data"]["writable"] is False or any(issue["severity"] == "degraded" for issue in body["data"]["issues"])
PY
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol8" >/dev/null

echo "case 9: broken symlink"
vol9="$(docker volume create)"
docker run --rm -v "$vol9":/data --entrypoint sh "$IMAGE" -c 'ln -s /no/such/nerdgram-target /data/broken && echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18789 -p 127.0.0.1:18789:8787 -v "$vol9":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["ok"] is True
assert any(issue["code"] == "tree-skip" for issue in body["data"]["issues"]), body
PY
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol9" >/dev/null

echo "case 11: instance name survives recreate"
vol11="$(docker volume create)"
docker rm -f ng-data-health >/dev/null 2>&1 || true
docker run -d --name ng-data-health -p 127.0.0.1:18791:8787 -v "$vol11":/data "$IMAGE" >/dev/null
wait_url 18791 ng-data-health
http_get "http://127.0.0.1:18791/api/instance" -H 'content-type: application/json' -d '{"name":"Lab"}' >/dev/null
docker rm -f ng-data-health >/dev/null
docker run -d --name ng-data-health -p 127.0.0.1:18791:8787 -v "$vol11":/data "$IMAGE" >/dev/null
wait_url 18791 ng-data-health
http_get "http://127.0.0.1:18791/api/instance" | python3 -c 'import json,sys; body=json.load(sys.stdin); assert body.get("instanceName") == "Lab" or body.get("configuredName") == "Lab", body'
docker exec ng-data-health sh -c 'test -f /data/.meta/instance.json'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol11" >/dev/null

echo "case 13: wrong-shape favorites.json"
vol13="$(docker volume create)"
docker run --rm -v "$vol13":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && printf "%s\n" "{\"not\":\"favorites\"}" > /data/.meta/favorites.json && echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18793 -p 127.0.0.1:18793:8787 -v "$vol13":/data)" || exit 1
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
issues = [issue for issue in body["data"]["issues"] if issue.get("file") == "favorites.json"]
assert issues, body
assert any("wrong shape" in issue.get("message", "") for issue in issues), body
assert body["data"]["quarantined"] >= 1, body
PY
docker exec ng-data-health sh -c '
  test -f /data/Welcome.mmd
  found=0
  for report in /data/.meta/quarantine/*/report.json; do
    grep -q "wrong shape" "$report" || continue
    grep -q "favorites.json" "$report" || continue
    if grep -q "{\"not\":\"favorites\"}" "$report"; then
      echo "quarantine report contains the favorites file" >&2
      cat "$report" >&2
      exit 1
    fi
    copy="$(dirname "$report")/favorites.json"
    test -f "$copy"
    grep -q "{\"not\":\"favorites\"}" "$copy"
    found=1
  done
  test "$found" = 1
'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol13" >/dev/null

echo "case 7: newer schemaVersion is not overwritten"
vol7="$(docker volume create)"
docker run --rm -v "$vol7":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && printf "%s\n" "{\"schemaVersion\":99,\"version\":1,\"folders\":[],\"items\":[]}" > /data/.meta/favorites.json && cp /data/.meta/favorites.json /data/.meta/favorites.orig && echo "flowchart LR" > /data/Welcome.mmd'
body="$(run_case ng-data-health 18787 -p 127.0.0.1:18787:8787 -v "$vol7":/data)" || exit 1
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert any(issue.get("code") == "newer-schema" for issue in body["data"]["issues"]), body
PY
doctor="$(http_get "http://127.0.0.1:18787/api/doctor")"
python3 - "$doctor" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
codes = {item.get("code") for item in body.get("blockers", [])}
assert "newer-schema" in codes, body
PY
docker exec ng-data-health sh -c 'cmp /data/.meta/favorites.json /data/.meta/favorites.orig && test -f /data/Welcome.mmd'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol7" >/dev/null

echo "case 10: two instances on one volume"
vol10="$(docker volume create)"
docker rm -f ng-data-health ng-data-health-b >/dev/null 2>&1 || true
docker run -d --name ng-data-health -p 127.0.0.1:18790:8787 -v "$vol10":/data "$IMAGE" >/dev/null
wait_url 18790 ng-data-health
docker run -d --name ng-data-health-b -p 127.0.0.1:18792:8787 -v "$vol10":/data "$IMAGE" >/dev/null
wait_url 18792 ng-data-health-b
body="$(http_get "http://127.0.0.1:18792/api/health")"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert body["data"]["instanceConflict"], body
assert any(issue.get("code") == "instance-conflict" for issue in body["data"]["issues"]), body
PY
docker rm -f ng-data-health ng-data-health-b >/dev/null
docker volume rm "$vol10" >/dev/null

echo "case 12: doctor --json, --repair, and --restore"
vol12="$(docker volume create)"
docker run --rm -v "$vol12":/data --entrypoint sh "$IMAGE" -c 'mkdir -p /data/.meta && : > /data/.meta/updates.json && printf "{" > /data/.meta/api-tokens.json && printf "%s\n" "{\"version\":1,\"folders\":[],\"items\":[]}" > /data/.meta/favorites.json && echo stale > /data/.meta/.ng-99-dead.tmp && touch -d "20 minutes ago" /data/.meta/.ng-99-dead.tmp && echo "flowchart LR" > /data/Welcome.mmd && echo "flowchart LR" > "/data/Welcome 2.mmd"'
docker rm -f ng-data-health >/dev/null 2>&1 || true
docker run -d --name ng-data-health -p 127.0.0.1:18794:8787 -v "$vol12":/data "$IMAGE" >/dev/null
wait_url 18794 ng-data-health
set +e
docker exec ng-data-health nerdgram doctor --json > "$ROOT/doctor.json"
json_code=$?
docker exec ng-data-health nerdgram doctor --repair > "$ROOT/repair.txt"
repair_code=$?
set -e
test "$json_code" -eq 1 -o "$json_code" -eq 2
test "$repair_code" -eq 0 -o "$repair_code" -eq 1
python3 - "$ROOT/doctor.json" << 'PY'
import json, sys
body = json.loads(open(sys.argv[1], encoding="utf-8").read())
assert body["ok"] is True
assert "status" in body
PY
docker exec ng-data-health sh -c 'test -f /data/Welcome.mmd && test -f "/data/Welcome 2.mmd" && test ! -e /data/.meta/.ng-99-dead.tmp && test -d /data/.meta/backups && grep -q schemaVersion /data/.meta/favorites.json'
stamp="$(docker exec ng-data-health sh -c 'ls /data/.meta/quarantine | head -n 1')"
test -n "$stamp"
set +e
docker exec ng-data-health nerdgram doctor --restore "$stamp" > "$ROOT/restore.txt"
restore_code=$?
set -e
test "$restore_code" -eq 0
grep -q "Diagrams were not changed" "$ROOT/restore.txt"
docker exec ng-data-health sh -c 'test -f /data/Welcome.mmd && test -f "/data/Welcome 2.mmd"'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol12" >/dev/null

echo "data-folder cases passed"

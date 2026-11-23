#!/usr/bin/env bash
# Phase 1 data-folder cases against a built image.
# Phase 2 cases (schemaVersion 99, two live instances, nerdgram doctor --repair)
# are not part of this script.
set -euo pipefail

IMAGE="${1:-nerdgram1337:ci}"
ROOT="$(mktemp -d)"
trap 'docker rm -f ng-data-health >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT

wait_url() {
  local port="$1"
  local name="$2"
  local url="http://127.0.0.1:${port}/api/health"
  local i
  for i in $(seq 1 40); do
    if curl -sf "$url" -H "Host: 127.0.0.1:${port}" >/dev/null; then
      return 0
    fi
    if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
      echo "container $name exited" >&2
      docker logs "$name" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  echo "timed out waiting for $url" >&2
  docker logs "$name" >&2 || true
  return 1
}

run_case() {
  local name="$1"
  local port="$2"
  shift 2
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" "$@" "$IMAGE" >/dev/null
  wait_url "$port" "$name"
  local body
  body="$(curl -sf "http://127.0.0.1:${port}/api/health" -H "Host: 127.0.0.1:${port}")"
  python3 - "$body" << 'PY'
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
body="$(run_case ng-data-health 18781 -p 127.0.0.1:18781:8787 -v "$vol1":/data)"
python3 - "$body" << 'PY'
import json, sys
body = json.loads(sys.argv[1])
assert any(issue.get("file") == "updates.json" for issue in body["data"]["issues"]), body
PY
curl -sf "http://127.0.0.1:18781/api/version" | python3 -c 'import json,sys; body=json.load(sys.stdin); assert body["version"]'
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
code="$(curl -s -o /tmp/ng-v1.json -w '%{http_code}' -H 'Authorization: Bearer ng_not-a-real-token' -H 'Host: 127.0.0.1:18782' 'http://127.0.0.1:18782/api/v1/history?path=Welcome.mmd')"
test "$code" = "401"
code="$(curl -s -o /tmp/ng-mcp.json -w '%{http_code}' -H 'Authorization: Bearer ng_not-a-real-token' -H 'Host: 127.0.0.1:18782' -H 'content-type: application/json' -d '{}' 'http://127.0.0.1:18782/mcp')"
test "$code" != "500"
test "$code" != "200"
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
curl -sf -H 'Host: 127.0.0.1:18791' -H 'content-type: application/json' -d '{"name":"Lab"}' 'http://127.0.0.1:18791/api/instance' >/dev/null
docker rm -f ng-data-health >/dev/null
docker run -d --name ng-data-health -p 127.0.0.1:18791:8787 -v "$vol11":/data "$IMAGE" >/dev/null
wait_url 18791 ng-data-health
curl -sf -H 'Host: 127.0.0.1:18791' 'http://127.0.0.1:18791/api/instance' | python3 -c 'import json,sys; body=json.load(sys.stdin); assert body.get("instanceName") == "Lab" or body.get("configuredName") == "Lab", body'
docker exec ng-data-health sh -c 'test -f /data/.meta/instance.json'
docker rm -f ng-data-health >/dev/null
docker volume rm "$vol11" >/dev/null

echo "data-folder cases passed"

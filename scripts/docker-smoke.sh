#!/usr/bin/env bash
# Start an already-built image, exercise /api/health through 127.0.0.1, write a
# diagram, restart, and check the process user. Removes only the containers,
# named volume, and temp directories this script creates.
set -euo pipefail

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "usage: scripts/docker-smoke.sh <image>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="nerdgram-smoke-$$"
ROOT_NAME="${NAME}-root"
BIND_NAME="${NAME}-bind"
VOLUME="nerdgram-smoke-$$"
PORT=8787
BIND_DIR=""
ROOT_DIR=""

cleanup() {
  docker rm -f "$NAME" "$ROOT_NAME" "$BIND_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  if [ -n "$BIND_DIR" ] || [ -n "$ROOT_DIR" ]; then
    sudo rm -rf "$BIND_DIR" "$ROOT_DIR"
  fi
}
trap cleanup EXIT

run_app() {
  local name="$1"
  shift
  docker run -d \
    --name "$name" \
    --read-only \
    --tmpfs /tmp \
    --security-opt no-new-privileges \
    -p "127.0.0.1:${PORT}:8787" \
    -e NERDGRAM_DATA_DIR=/data \
    -e NERDGRAM_INSTALL=docker \
    -e NERDGRAM_ALLOWED_HOSTS=lan.example \
    -e NERDGRAM_CORS_ORIGINS="http://lan.example:${PORT}" \
    "$@" \
    "$IMAGE" >/dev/null
}

wait_http() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "health check did not pass on 127.0.0.1:${PORT}" >&2
  return 1
}

wait_docker_health() {
  local name="$1"
  local i status=""
  for i in $(seq 1 40); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name")"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    sleep 1
  done
  echo "container ${name} health is ${status:-missing}" >&2
  docker logs "$name" >&2 || true
  return 1
}

code_of() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

# Like http, but a failed status prints the URL and the response body.
http() {
  local out code
  out="$(mktemp)"
  if ! code="$(curl -sS -o "$out" -w '%{http_code}' "$@")"; then
    echo "request failed: curl $*" >&2
    echo "response body:" >&2
    cat "$out" >&2 || true
    rm -f "$out"
    exit 22
  fi
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "request failed: HTTP ${code}" >&2
    echo "curl $*" >&2
    echo "response body:" >&2
    cat "$out" >&2 || true
    rm -f "$out"
    exit 22
  fi
  cat "$out"
  rm -f "$out"
}

unset NERDGRAM_GITHUB_TOKEN NERDGRAM_GITHUB_CLIENT_ID || true
docker compose config --quiet
echo "compose config ok"

run_app "$NAME" -v "${VOLUME}:/data"
if ! wait_http; then
  docker logs "$NAME" >&2 || true
  exit 1
fi
wait_docker_health "$NAME"

HEALTH="$(http "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}")"
export HEALTH
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { codenameForVersion } from "./scripts/codenames.mjs";
const health = JSON.parse(process.env.HEALTH);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (health.ok !== true) throw new Error("health ok");
if (health.installKind !== "docker") throw new Error("installKind " + health.installKind);
if (health.dataDir !== "/data") throw new Error("dataDir " + health.dataDir);
if (health.name !== "NerdGram1337") throw new Error("name");
if (health.version !== pkg.version) throw new Error("version " + health.version);
if (health.codename !== codenameForVersion(pkg.version, pkg.codenames)) throw new Error("codename " + health.codename);
const expected = process.env.NERDGRAM_EXPECT_COMMIT || "";
if (expected && health.commit !== expected) throw new Error("commit " + health.commit);
'
LABEL_VERSION="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE")"
LABEL_NAME="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.codename"}}' "$IMAGE")"
ENV_NAME="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | sed -n 's/^NERDGRAM_CODENAME=//p')"
test "$LABEL_VERSION" = "$(node -p "require('./package.json').version")"
test "$LABEL_NAME" = "$(node scripts/codenames.mjs)"
test "$ENV_NAME" = "$LABEL_NAME"

http "http://127.0.0.1:${PORT}/api/health" -H "Host: localhost:${PORT}" >/dev/null
http "http://localhost:${PORT}/api/health" >/dev/null
test "$(code_of "http://127.0.0.1:${PORT}/api/health" -H "Host: evil.example")" = "403"
test "$(code_of "http://127.0.0.1:${PORT}/api/health" -H "Host: lan.example:${PORT}")" = "200"

REF="$(http "http://127.0.0.1:${PORT}/api/reference" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!Array.isArray(b.pages) || b.pages.length < 1) process.exit(1)' "$REF"
TPL="$(http "http://127.0.0.1:${PORT}/api/templates" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!Array.isArray(b.templates) || b.templates.length < 1) process.exit(1)' "$TPL"
WELCOME="$(http "http://127.0.0.1:${PORT}/api/file?path=Welcome.mmd" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (typeof b.content !== "string" || b.content.length < 1) process.exit(1)' "$WELCOME"

echo "every bundled sample is in the image and was seeded"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  docker exec "$NAME" test -f "/app/diagrams/$rel"
  docker exec "$NAME" test -f "/data/$rel"
done < <(find diagrams -name '*.mmd' -printf '%P\n' | sort)

TOKEN_JSON="$(http -X POST "http://127.0.0.1:${PORT}/api/tokens" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke","scope":"read-write"}')"
SMOKE_TOKEN="$(node -e 'const b=JSON.parse(process.argv[1]); if (!b.token || !b.token.startsWith("ng_")) process.exit(1); process.stdout.write(b.token)' "$TOKEN_JSON")"
test "$(code_of "http://127.0.0.1:${PORT}/api/v1/diagrams" -H "Host: 127.0.0.1:${PORT}")" = "401"
http "http://127.0.0.1:${PORT}/api/v1/openapi.json" -H "Host: 127.0.0.1:${PORT}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const b=JSON.parse(s); if (b.openapi !== "3.0.3" || !b.paths["/api/v1/diagrams"]) process.exit(1)})'
http -X POST "http://127.0.0.1:${PORT}/api/v1/render" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Authorization: Bearer ${SMOKE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Welcome.mmd","format":"svg"}' \
  >/tmp/nerdgram-smoke.svg
grep -q "<svg" /tmp/nerdgram-smoke.svg
http -X POST "http://127.0.0.1:${PORT}/api/v1/render" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Authorization: Bearer ${SMOKE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Welcome.mmd","format":"png"}' \
  >/tmp/nerdgram-smoke.png
node -e 'const fs=require("fs"); const b=fs.readFileSync("/tmp/nerdgram-smoke.png"); if (b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a") process.exit(1)'
docker exec -e NERDGRAM_URL=http://127.0.0.1:8787 -e NERDGRAM_TOKEN="$SMOKE_TOKEN" "$NAME" nerdgram list --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const b=JSON.parse(s); if (b.ok!==true || !Array.isArray(b.files)) process.exit(1)})'
docker exec "$NAME" nerdgram --help | grep -q "nerdgram"

CREATE="$(http -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Smoke.mmd","content":"flowchart LR\n  Smoke[Persist me]\n"}')"
node -e 'const b=JSON.parse(process.argv[1]); if (b.path !== "Smoke.mmd") process.exit(1)' "$CREATE"

http -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: localhost:${PORT}" \
  -H "Origin: http://localhost:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Localhost.mmd","content":"flowchart LR\n  L[localhost]\n"}' >/dev/null

test "$(code_of -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: lan.example:${PORT}" \
  -H "Origin: http://lan.example:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Lan.mmd","content":"flowchart LR\n  N[lan]\n"}')" = "200"

test "$(code_of -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: text/plain" \
  -d nope)" = "415"

docker exec "$NAME" node --input-type=module -e 'import { writeToken } from "./server/dist/sync/secrets.js"; await writeToken("smoke-token-not-a-real-github-token");'
test "$(docker exec "$NAME" stat -c %a /data/.meta/github-token)" = "600"
docker exec "$NAME" mkdir -p /data/.nerdgram-git
docker exec "$NAME" sh -c 'printf mirror > /data/.nerdgram-git/SMOKE'

test "$(docker exec "$NAME" id -u)" = "1001"
test "$(docker exec "$NAME" awk '/^Uid:/ {print $2; exit}' /proc/1/status)" = "1001"
if docker exec "$NAME" sh -c 'command -v git >/dev/null 2>&1'; then
  echo "git binary is present in the runtime image" >&2
  exit 1
fi
if docker exec "$NAME" sh -c 'test -e /app/server/node_modules/typescript -o -e /app/server/src -o -e /usr/bin/git'; then
  echo "dev tools or server source are in the runtime image" >&2
  exit 1
fi
if docker exec "$NAME" sh -c 'touch /app/reference/manifest.json' >/dev/null 2>&1; then
  echo "reference tree is writable" >&2
  exit 1
fi
docker exec "$NAME" sh -c 'test -d /app/templates && test -d /app/reference && test -d /app/client/dist && test -f /app/server/dist/index.js'

echo "stopping container to check SIGTERM and persistence"
docker stop "$NAME" >/dev/null
test "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0"
docker start "$NAME" >/dev/null
if ! wait_http; then
  docker logs "$NAME" >&2 || true
  exit 1
fi
AFTER="$(http "http://127.0.0.1:${PORT}/api/file?path=Smoke.mmd" -H "Host: 127.0.0.1:${PORT}")"
node -e 'const b=JSON.parse(process.argv[1]); if (!String(b.content).includes("Persist me")) process.exit(1)' "$AFTER"
test "$(docker exec "$NAME" stat -c %a /data/.meta/github-token)" = "600"
docker exec "$NAME" cat /data/.nerdgram-git/SMOKE | grep -q mirror

echo "root-owned bind mount boots degraded and refuses writes"
docker stop "$NAME" >/dev/null
ROOT_DIR="$(mktemp -d)"
# GitHub-hosted runners are uid 1001, the same as the image user. A fresh
# mktemp directory would be writable. Force a directory the process cannot write.
sudo chown root:root "$ROOT_DIR"
sudo chmod 755 "$ROOT_DIR"
docker run -d \
  --name "$ROOT_NAME" \
  --read-only \
  --tmpfs /tmp \
  -p "127.0.0.1:${PORT}:8787" \
  -v "${ROOT_DIR}:/data" \
  "$IMAGE" >/dev/null
if ! wait_http; then
  docker logs "$ROOT_NAME" >&2 || true
  exit 1
fi
sleep 2
test "$(docker inspect -f '{{.State.Running}}' "$ROOT_NAME")" = "true"
test "$(docker inspect -f '{{.RestartCount}}' "$ROOT_NAME")" = "0"
ROOT_HEALTH="$(http "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}")"
export ROOT_HEALTH
node --input-type=module -e '
const health = JSON.parse(process.env.ROOT_HEALTH);
if (health.ok !== true) throw new Error("health ok");
if (!health.data || health.data.status !== "degraded") throw new Error("status " + JSON.stringify(health.data));
if (health.data.writable !== false) throw new Error("writable");
const hint = (health.data.issues || []).some((issue) => String(issue.message || "").includes("1001:1001"));
if (!hint) throw new Error("missing chown hint " + JSON.stringify(health.data.issues));
'
WRITE_BODY="$(mktemp)"
WRITE_CODE="$(curl -sS -o "$WRITE_BODY" -w '%{http_code}' -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Nope.mmd","content":"flowchart LR\n  N[nope]\n"}')"
if [ "$WRITE_CODE" = "200" ] || [ "$WRITE_CODE" = "500" ]; then
  echo "unwritable save returned HTTP ${WRITE_CODE}" >&2
  cat "$WRITE_BODY" >&2
  exit 1
fi
case "$WRITE_CODE" in
  4*|503) ;;
  *)
    echo "unwritable save returned HTTP ${WRITE_CODE}" >&2
    cat "$WRITE_BODY" >&2
    exit 1
    ;;
esac
if ! grep -q "not writable\|1001:1001\|read-only\|disk space" "$WRITE_BODY"; then
  echo "unwritable save did not explain the refusal" >&2
  cat "$WRITE_BODY" >&2
  exit 1
fi
rm -f "$WRITE_BODY"
if [ -n "$(find "$ROOT_DIR" -mindepth 1 -print -quit)" ]; then
  echo "root-owned bind mount was modified" >&2
  find "$ROOT_DIR" >&2
  exit 1
fi
set +e
docker exec "$ROOT_NAME" nerdgram doctor >/tmp/nerdgram-doctor.txt
DOC=$?
set -e
test "$DOC" = "2"
grep -q "1001:1001" /tmp/nerdgram-doctor.txt
docker rm -f "$ROOT_NAME" >/dev/null

echo "bind mount owned by uid 1001 is writable"
BIND_DIR="$(mktemp -d)"
sudo chown 1001:1001 "$BIND_DIR"
sudo chmod 755 "$BIND_DIR"
run_app "$BIND_NAME" -v "${BIND_DIR}:/data"
if ! wait_http; then
  docker logs "$BIND_NAME" >&2 || true
  exit 1
fi
http -X PUT "http://127.0.0.1:${PORT}/api/file" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Bind.mmd","content":"flowchart LR\n  B[bind]\n"}' >/dev/null
grep -q bind "${BIND_DIR}/Bind.mmd"
test "$(stat -c %u "${BIND_DIR}/Bind.mmd")" = "1001"

echo "smoke ok (${IMAGE})"

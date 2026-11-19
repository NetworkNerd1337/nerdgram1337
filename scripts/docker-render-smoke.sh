#!/usr/bin/env bash
# Render SVG and PNG inside an already-built image, on the given platform.
# A browser built for the wrong architecture fails this script: the ELF check
# rejects it, and Chromium or chrome-headless-shell will not start.
# Publishes 127.0.0.1 only, the same loopback publish as compose.yaml.
set -euo pipefail

IMAGE="${1:-}"
PLATFORM="${2:-}"
if [ -z "$IMAGE" ] || [ -z "$PLATFORM" ]; then
  echo "usage: scripts/docker-render-smoke.sh <image> <linux/amd64|linux/arm64>" >&2
  exit 2
fi
case "$PLATFORM" in
  linux/amd64|linux/arm64) ;;
  *) echo "unsupported platform: $PLATFORM" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="nerdgram-render-$$"
VOLUME="nerdgram-render-$$"
PORT=8787

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f /tmp/nerdgram-render.svg /tmp/nerdgram-render.png
}
trap cleanup EXIT

echo "render smoke ${PLATFORM}: starting ${IMAGE}"
RUN_ENV=(
  -e NERDGRAM_DATA_DIR=/data
  -e NERDGRAM_INSTALL=docker
)
# QEMU is slow enough that the default 30s launch and 20s page timeouts can
# fire before Debian chromium finishes a diagram. Real arm64 hardware does
# not need this.
if [ "$PLATFORM" = "linux/arm64" ]; then
  RUN_ENV+=(
    -e NERDGRAM_RENDER_LAUNCH_TIMEOUT_MS=180000
    -e NERDGRAM_RENDER_TIMEOUT_MS=120000
  )
fi

docker run -d \
  --name "$NAME" \
  --platform "$PLATFORM" \
  --read-only \
  --tmpfs /tmp \
  --security-opt no-new-privileges \
  -p "127.0.0.1:${PORT}:8787" \
  -v "${VOLUME}:/data" \
  "${RUN_ENV[@]}" \
  "$IMAGE" >/dev/null

fail() {
  echo "render smoke ${PLATFORM}: $1" >&2
  docker logs "$NAME" >&2 || true
  exit 1
}

# ELF e_machine: 62 is x86-64, 183 is aarch64. A script at /usr/bin/chromium
# is the Debian launcher; the binary it execs is /usr/lib/chromium/chromium.
docker exec -e SMOKE_PLATFORM="$PLATFORM" "$NAME" node --input-type=module -e '
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const platform = process.env.SMOKE_PLATFORM;
const want = platform === "linux/arm64" ? 183 : 62;
const configured = (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
let binary = "";
let label = "";
if (platform === "linux/arm64") {
  if (configured !== "/usr/bin/chromium") {
    console.error("arm64 image must set PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium, got " + (configured || "(empty)"));
    process.exit(1);
  }
  binary = "/usr/lib/chromium/chromium";
  label = "Debian chromium";
} else {
  if (configured) {
    console.error("amd64 image must keep the Puppeteer shell, got PUPPETEER_EXECUTABLE_PATH=" + configured);
    process.exit(1);
  }
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const stat = statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (name === "chrome-headless-shell") found.push(abs);
    }
  };
  walk("/opt/puppeteer");
  if (found.length !== 1) {
    console.error("expected one chrome-headless-shell, found " + found.join(", "));
    process.exit(1);
  }
  binary = found[0];
  label = "chrome-headless-shell " + binary;
}
const buf = readFileSync(binary);
if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
  console.error(binary + " is not an ELF");
  process.exit(1);
}
const machine = buf.readUInt16LE(18);
if (machine !== want) {
  console.error(binary + " ELF machine " + machine + " does not match " + platform);
  process.exit(1);
}
const names = { 62: "x86-64", 183: "aarch64" };
console.log("render smoke " + platform + ": browser " + label + " elf " + (names[machine] || machine) + " process " + process.arch);
' || fail "browser architecture check failed"

if [ "$PLATFORM" = "linux/arm64" ]; then
  VERSION=$(docker exec "$NAME" dpkg-query -W -f='${Version}' chromium)
  echo "render smoke ${PLATFORM}: chromium package ${VERSION}"
  docker exec "$NAME" chromium --version || echo "render smoke ${PLATFORM}: chromium --version exited non-zero" >&2
fi

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" -H "Host: 127.0.0.1:${PORT}" >/dev/null || fail "health check did not pass"

TOKEN_JSON="$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/tokens" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Origin: http://127.0.0.1:${PORT}" \
  -H "Content-Type: application/json" \
  -d '{"name":"render-smoke","scope":"read-write"}')"
SMOKE_TOKEN="$(node -e 'const b=JSON.parse(process.argv[1]); if (!b.token || !b.token.startsWith("ng_")) process.exit(1); process.stdout.write(b.token)' "$TOKEN_JSON")"

curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/render" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Authorization: Bearer ${SMOKE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Welcome.mmd","format":"svg"}' \
  -o /tmp/nerdgram-render.svg || fail "api svg render failed"
grep -q "<svg" /tmp/nerdgram-render.svg || fail "api svg did not contain an svg"
echo "render smoke ${PLATFORM}: api svg ok"

curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/render" \
  -H "Host: 127.0.0.1:${PORT}" \
  -H "Authorization: Bearer ${SMOKE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"path":"Welcome.mmd","format":"png"}' \
  -o /tmp/nerdgram-render.png || fail "api png render failed"
node -e 'const fs=require("fs"); const b=fs.readFileSync("/tmp/nerdgram-render.png"); if (b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a") process.exit(1)' \
  || fail "api png is not a png"
echo "render smoke ${PLATFORM}: api png ok"

docker exec -i \
  -e SMOKE_PLATFORM="$PLATFORM" \
  -e NERDGRAM_URL=http://127.0.0.1:8787 \
  -e NERDGRAM_TOKEN="$SMOKE_TOKEN" \
  -w /app/server \
  "$NAME" \
  node --input-type=module < "$ROOT/scripts/docker-render-mcp.mjs" \
  || fail "mcp render failed"

echo "render smoke ok (${IMAGE}, ${PLATFORM})"

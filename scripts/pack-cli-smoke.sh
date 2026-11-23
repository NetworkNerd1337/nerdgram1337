#!/usr/bin/env bash
# Pack cli/ and prove the tarball runs on a clean directory.
# npm pack --dry-run lists the registry contents. The install and npx steps
# use that same tarball, not the checkout's server/dist.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

export PUPPETEER_SKIP_DOWNLOAD=1

dry="$(mktemp)"
tarball_json="$(mktemp)"
work="$(mktemp -d)"
tarball=""
cleanup() {
  rm -rf "$work"
  rm -f "$dry" "$tarball_json"
  if [ -n "$tarball" ]; then
    rm -f "$tarball"
  fi
}
trap cleanup EXIT

cd "$root/cli"
echo "npm pack --dry-run"
npm pack --dry-run --json > "$dry"

PACK_JSON="$dry" node --input-type=module <<'EOF'
import fs from "node:fs";
const packs = JSON.parse(fs.readFileSync(process.env.PACK_JSON, "utf8"));
const pack = Array.isArray(packs) ? packs[0] : packs;
if (!pack || pack.name !== "nerdgram1337") {
  console.error("npm pack --dry-run did not describe nerdgram1337.");
  process.exit(1);
}
const files = (pack.files ?? []).map((file) => (typeof file === "string" ? file : file.path));
const required = ["package.json", "bin/nerdgram.js", "dist/cli.js", "README.md", "LICENSE"];
const missing = required.filter((file) => !files.includes(file));
if (missing.length > 0) {
  console.error(`Tarball is missing ${missing.join(", ")}.`);
  console.error(files.join("\n"));
  process.exit(1);
}
if (files.some((file) => file.includes("node_modules") || file.startsWith("server/"))) {
  console.error("Tarball includes files outside the CLI package.");
  process.exit(1);
}
const unpacked = Number(pack.unpackedSize ?? 0);
if (!Number.isFinite(unpacked) || unpacked <= 0 || unpacked > 5_000_000) {
  console.error(`Tarball unpacked size ${unpacked} is outside the expected range.`);
  process.exit(1);
}
console.log(`Dry run ok: ${pack.name}@${pack.version}, ${files.length} files, ${unpacked} bytes unpacked.`);
EOF

echo "npm pack"
npm pack --json > "$tarball_json"
filename="$(PACK_JSON="$tarball_json" node --input-type=module <<'EOF'
import fs from "node:fs";
const packs = JSON.parse(fs.readFileSync(process.env.PACK_JSON, "utf8"));
const pack = Array.isArray(packs) ? packs[0] : packs;
if (!pack?.filename || pack.name !== "nerdgram1337") {
  console.error("npm pack did not write a nerdgram1337 tarball.");
  process.exit(1);
}
process.stdout.write(pack.filename);
EOF
)"
tarball="$root/cli/$filename"

if [ ! -f "$tarball" ]; then
  echo "Missing tarball $tarball" >&2
  exit 1
fi

install="$work/install"
mkdir -p "$install"
cd "$install"
npm init -y >/dev/null
npm install --no-fund --no-audit "$tarball"

echo "nerdgram --version from the installed tarball"
version_out="$("$install/node_modules/.bin/nerdgram" --version)"
printf '%s\n' "$version_out"
expected_name="$(node "$root/scripts/codenames.mjs")"
case "$version_out" in
  *" $expected_name"*) ;;
  *)
    echo "Packed nerdgram --version did not include the code name ${expected_name}." >&2
    exit 1
    ;;
esac

echo "nerdgram --help from the installed tarball"
"$install/node_modules/.bin/nerdgram" --help > "$work/help.txt"
if ! grep -q "repair-links" "$work/help.txt"; then
  echo "nerdgram --help did not print the command list." >&2
  cat "$work/help.txt" >&2
  exit 1
fi

printf 'flowchart LR\n  A[One] --> B[Two]\n' > "$work/tiny.mmd"
echo "nerdgram lint of a local file from the installed tarball"
"$install/node_modules/.bin/nerdgram" lint "$work/tiny.mmd" > "$work/lint.txt"

npxdir="$work/npx"
mkdir -p "$npxdir"
cd "$npxdir"
echo "npx from the tarball"
npx --yes --package "$tarball" nerdgram --help > "$work/npx-help.txt"
if ! grep -q "repair-links" "$work/npx-help.txt"; then
  echo "npx from the tarball did not print the command list." >&2
  cat "$work/npx-help.txt" >&2
  exit 1
fi

if [ ! -f "$root/server/dist/index.js" ]; then
  echo "server/dist/index.js is missing. Run npm run build before the CLI pack smoke." >&2
  exit 1
fi

mcp_data="$work/mcp-data"
mkdir -p "$mcp_data"
mcp_port=8791
echo "API for the packed nerdgram mcp handshake"
NERDGRAM_DATA_DIR="$mcp_data" PORT="$mcp_port" HOST=127.0.0.1 \
  node "$root/server/dist/index.js" > "$work/mcp-server.log" 2>&1 &
mcp_server_pid=$!
cleanup_mcp() {
  if [ -n "${mcp_server_pid:-}" ]; then
    kill "$mcp_server_pid" >/dev/null 2>&1 || true
    wait "$mcp_server_pid" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_mcp; cleanup' EXIT

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS -H "Host: 127.0.0.1:${mcp_port}" "http://127.0.0.1:${mcp_port}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != 1 ]; then
  echo "The API did not start for the MCP smoke." >&2
  cat "$work/mcp-server.log" >&2
  exit 1
fi

token_json="$(curl -fsS -X POST "http://127.0.0.1:${mcp_port}/api/tokens" \
  -H "Host: 127.0.0.1:${mcp_port}" \
  -H "Content-Type: application/json" \
  -d '{"name":"mcp-smoke","scope":"read"}')"
mcp_token="$(printf '%s' "$token_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const b=JSON.parse(s); if(!b.token){process.stderr.write("no token\n"); process.exit(1);} process.stdout.write(b.token);})')"

echo "nerdgram mcp initialize and tools/list from the installed tarball"
NERDGRAM_URL="http://127.0.0.1:${mcp_port}" NERDGRAM_TOKEN="$mcp_token" \
  node --input-type=module <<EOF
import { spawn } from "node:child_process";

const child = spawn("$install/node_modules/.bin/nerdgram", ["mcp"], {
  env: { ...process.env, NERDGRAM_URL: "http://127.0.0.1:${mcp_port}", NERDGRAM_TOKEN: process.env.NERDGRAM_TOKEN },
  stdio: ["pipe", "pipe", "pipe"],
});
let out = "";
let err = "";
child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { err += chunk.toString("utf8"); });
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } },
});
const started = Date.now();
while (!out.split("\n").some((line) => { try { return JSON.parse(line).id === 1; } catch { return false; } })) {
  if (Date.now() - started > 20000) {
    console.error(err || out || "initialize timed out");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (err.includes("Cannot find module")) {
  console.error(err);
  process.exit(1);
}
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const listedAt = Date.now();
let tools = null;
while (!tools) {
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      if (message.id === 2) tools = message;
    } catch { /* partial line */ }
  }
  if (tools) break;
  if (Date.now() - listedAt > 20000) {
    console.error(err || out || "tools/list timed out");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const names = (tools.result?.tools ?? []).map((tool) => tool.name);
if (!names.some((name) => name.startsWith("nerdgram_"))) {
  console.error(JSON.stringify(tools));
  process.exit(1);
}
console.log("MCP tools:", names.join(", "));
child.kill();
EOF

echo "CLI pack smoke passed."

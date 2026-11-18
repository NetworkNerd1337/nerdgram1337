#!/bin/sh
# Preview, then upsert, the campus network sample.
#
# The first run creates the diagram. The next run of the same path updates the
# generated block and the sibling data file. This script does not call
# create-only generate, and it does not fall back to refresh.
#
# From the repository root, with the server on 127.0.0.1:8787:
#
#   NERDGRAM_TOKEN=ng_your_token sh docs/samples/push-campus.sh
#
# Layer 2, grouped by platform:
#
#   NERDGRAM_TOKEN=ng_your_token NERDGRAM_VIEW=l2 NERDGRAM_GROUP_BY=platform \
#     NERDGRAM_PATH=Campus-L2.mmd sh docs/samples/push-campus.sh
#
# The same call as curl. Replace the token, and keep the body as one JSON object.
# `text` is the campus sample. Fetch the contract first (no token):
#
#   curl -fsS "http://127.0.0.1:8787/api/v1/openapi.json"
#   curl -fsS "http://127.0.0.1:8787/api/v1/schema/network.json"
#   curl -fsS "http://127.0.0.1:8787/api/v1/schema/graph.json"
#   curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate/preview" \
#     -H "Authorization: Bearer ng_your_token" \
#     -H "Content-Type: application/json" \
#     -d @/tmp/nerdgram-campus.json
#   curl -fsS -X POST "http://127.0.0.1:8787/api/v1/generate/upsert" \
#     -H "Authorization: Bearer ng_your_token" \
#     -H "Content-Type: application/json" \
#     -d @/tmp/nerdgram-campus.json
#
# Cron, every night at 02:15, from a checkout of this repository:
#
#   15 2 * * * cd /path/to/NerdGram1337 && NERDGRAM_TOKEN=ng_your_token sh docs/samples/push-campus.sh
#
# NERDGRAM_URL defaults to http://127.0.0.1:8787. NERDGRAM_PATH defaults to
# Campus-L3.mmd. NERDGRAM_VIEW defaults to l3. Set NERDGRAM_GROUP_BY to
# platform, site, role, vrf, or capability when you want a group.

set -eu

BASE="${NERDGRAM_URL:-http://127.0.0.1:8787}"
TOKEN="${NERDGRAM_TOKEN:?Set NERDGRAM_TOKEN to a read-write automation token.}"
DIAGRAM="${NERDGRAM_PATH:-Campus-L3.mmd}"
VIEW="${NERDGRAM_VIEW:-l3}"
GROUP_BY="${NERDGRAM_GROUP_BY:-}"
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
SAMPLE="$ROOT/docs/samples/network/campus.network.json"

curl -fsS "$BASE/api/v1/openapi.json" -o /dev/null
curl -fsS "$BASE/api/v1/schema/network.json" -o /dev/null
curl -fsS "$BASE/api/v1/schema/graph.json" -o /dev/null

BODY=$(
  DIAGRAM="$DIAGRAM" VIEW="$VIEW" GROUP_BY="$GROUP_BY" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const text = readFileSync(process.argv[1], "utf8");
    const body = {
      path: process.env.DIAGRAM,
      format: "network",
      view: process.env.VIEW,
      text,
    };
    if (process.env.GROUP_BY) body.groupBy = process.env.GROUP_BY;
    process.stdout.write(JSON.stringify(body));
  ' "$SAMPLE"
)

post() {
  curl -fsS -X POST "$BASE$1" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY"
}

PREVIEW=$(post /api/v1/generate/preview)
node --input-type=module -e '
  const body = JSON.parse(process.argv[1]);
  if (!Array.isArray(body.errors) || body.errors.length > 0) {
    console.error("Preview reported errors.");
    console.error(JSON.stringify(body.errors ?? body));
    process.exit(1);
  }
' "$PREVIEW"

UPSERT=$(post /api/v1/generate/upsert)
node --input-type=module -e '
  const body = JSON.parse(process.argv[1]);
  if (typeof body.created !== "boolean" || typeof body.path !== "string") {
    console.error("Upsert response did not say whether it created or updated.");
    process.exit(1);
  }
  process.stdout.write(body.created ? "created\n" : "updated\n");
  process.stdout.write(body.path + "\n");
' "$UPSERT"

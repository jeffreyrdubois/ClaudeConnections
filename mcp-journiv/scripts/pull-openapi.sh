#!/usr/bin/env bash
# Pull Journiv's OpenAPI spec and commit it as the early-warning system for
# breaking API changes. Diff journiv-api.json after every Journiv upgrade — a
# non-trivial diff (especially to /moments, /entries, /tags, or /auth) is your
# cue to re-check this MCP before trusting it again.
#
# Usage:
#   JOURNIV_URL=http://localhost:8000 ./scripts/pull-openapi.sh
#
# Run it against Journiv's INTERNAL address (e.g. from the Unraid host, or a box
# on the same Docker network) — not the public Cloudflare-Access hostname.
set -euo pipefail

JOURNIV_URL="${JOURNIV_URL:-http://localhost:8000}"
OUT="$(dirname "$0")/../journiv-api.json"

echo "Fetching OpenAPI spec from ${JOURNIV_URL}/openapi.json ..."
if command -v jq >/dev/null 2>&1; then
  curl -fsS "${JOURNIV_URL}/openapi.json" | jq . > "$OUT"
else
  echo "(jq not found — saving unformatted)"
  curl -fsS "${JOURNIV_URL}/openapi.json" > "$OUT"
fi

echo "Wrote $(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
echo "Commit it, then 'git diff' it after each Journiv upgrade."

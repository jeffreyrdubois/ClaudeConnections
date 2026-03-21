#!/bin/sh
# Ancestry MCP Server entrypoint
#
# Scans /data for any .ged file and processes it automatically on startup
# if the JSON output is missing or older than the source file.
#
# To refresh data after downloading a new GEDCOM export from Ancestry.com:
#   1. Drop the new .ged file into the mapped /data directory.
#   2. Restart the container — it will auto-detect and reprocess.

set -e

DATA_PATH="${DATA_PATH:-/data/ancestry.json}"

# Find any .ged file in the data directory (case-insensitive, first match wins)
GEDCOM_PATH=$(find /data -maxdepth 1 -iname "*.ged" 2>/dev/null | head -1)

if [ -n "$GEDCOM_PATH" ]; then
  if [ ! -f "$DATA_PATH" ] || [ "$GEDCOM_PATH" -nt "$DATA_PATH" ]; then
    echo "Processing GEDCOM file: $GEDCOM_PATH"
    python3 /app/scripts/process_gedcom.py "$GEDCOM_PATH" "$DATA_PATH"
  else
    echo "JSON data is up to date — skipping GEDCOM processing"
  fi
else
  echo "No .ged file found in /data"
  echo "Export your Ancestry.com tree as a GEDCOM and place it in the data directory, then restart."
fi

exec node dist/index.js

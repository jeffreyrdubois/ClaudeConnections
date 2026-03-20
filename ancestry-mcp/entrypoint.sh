#!/bin/sh
# Ancestry MCP Server entrypoint
#
# If a GEDCOM file exists at GEDCOM_PATH and the processed JSON at DATA_PATH
# is either missing or older than the GEDCOM, the Python processing script
# runs automatically before starting the Node server.
#
# To refresh data after downloading a new GEDCOM export from Ancestry.com:
#   1. Copy the .ged file into the mapped /data volume.
#   2. Restart the container  — OR —
#      docker exec ancestry-mcp python3 /app/scripts/process_gedcom.py \
#        /data/ancestry.ged /data/ancestry.json

set -e

GEDCOM_PATH="${GEDCOM_PATH:-/data/ancestry.ged}"
DATA_PATH="${DATA_PATH:-/data/ancestry.json}"

if [ -f "$GEDCOM_PATH" ]; then
  if [ ! -f "$DATA_PATH" ] || [ "$GEDCOM_PATH" -nt "$DATA_PATH" ]; then
    echo "Processing GEDCOM file: $GEDCOM_PATH"
    python3 /app/scripts/process_gedcom.py "$GEDCOM_PATH" "$DATA_PATH"
  else
    echo "JSON data is up to date — skipping GEDCOM processing"
  fi
else
  echo "No GEDCOM file found at $GEDCOM_PATH"
  echo "Export your Ancestry.com tree as a GEDCOM and place it at $GEDCOM_PATH, then restart."
fi

exec node dist/index.js

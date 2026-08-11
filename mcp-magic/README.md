# mcp-magic

MCP server (plus a web UI) for Magic: The Gathering collection and deck
management — search Scryfall, track your collection, and build decks.

Runs as a standalone Docker container on host port **3003** (the app listens on
`3000` inside the container). Configuration is documented in
[`.env.example`](./.env.example) and [`unraid-template.xml`](./unraid-template.xml).

## Install

This server follows the shared install flow for this repo:
**image → config → tunnel → connector → verify.**

See the **[install runbook in the root README](../README.md#how-to-install-a-new-mcp-server-on-unraid)**.

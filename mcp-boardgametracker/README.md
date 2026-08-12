# mcp-boardgametracker

Board game tracker (MCP server plus a web UI) for logging matches, results, and
analytics.

Runs as a standalone Docker container on host port **3004** (the app listens on
`3000` inside the container). Configuration is documented in
[`unraid-template.xml`](./unraid-template.xml).

## Install

This server follows the shared install flow for this repo:
**image → config → tunnel → connector → verify.**

See the **[install runbook in the root README](../README.md#how-to-install-a-new-mcp-server-on-unraid)**.

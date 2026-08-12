# mcp-ynab

MCP server exposing YNAB budget data to Claude — account balances, transactions,
and category budgets in real time.

Runs as a standalone Docker container on host port **3000** (the app listens on
`3000` inside the container). Configuration is documented in
[`.env.example`](./.env.example) and [`unraid-template.xml`](./unraid-template.xml).

## Install

This server follows the shared install flow for this repo:
**image → config → tunnel → connector → verify.**

See the **[install runbook in the root README](../README.md#how-to-install-a-new-mcp-server-on-unraid)**.

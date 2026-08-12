# ClaudeConnections

A monorepo of self-hosted [MCP](https://modelcontextprotocol.io) servers that
connect Claude to services running on my Unraid box. Each lives in its own
`mcp-*/` folder with its own Docker image, and each is published to GHCR and run
as a separate container. A shared **cloudflared** tunnel (configured on the
server, not in this repo) puts each one behind its own public hostname, and each
is registered in Claude as a remote connector.

## Servers

| Server | Host port | What it connects Claude to |
|---|---|---|
| [`mcp-ynab`](./mcp-ynab) | 3000 | YNAB budget data |
| [`mcp-mediamanager`](./mcp-mediamanager) | 3001 | Sonarr, Radarr, Tautulli, Overseerr |
| [`mcp-ancestry`](./mcp-ancestry) | 3002 | Family tree data (via GEDCOM) |
| [`mcp-magic`](./mcp-magic) | 3003 | Magic: The Gathering collection & decks |
| [`mcp-boardgametracker`](./mcp-boardgametracker) | 3004 | Board game match tracking |
| [`mcp-journiv`](./mcp-journiv) | 3005 | Self-hosted Journiv journal (`ai`-tagged entries only) |

**Host ports are unique per server** so they can all run side by side. When you
add a new server, give it the next free port. Inside every container the app
still listens on `3000`; only the host-side mapping (`<hostPort>:3000`) differs,
and cloudflared reaches each container by name on port `3000` regardless.

Each server folder has its own `README.md` with server-specific setup (which
env vars it needs, what account/token to create, etc.). This file is the
**how-do-I-install-one** runbook.

---

## How to install a new MCP server on Unraid

Once a server's code is merged to `main`, GitHub Actions builds and pushes its
image to `ghcr.io/jeffreyrdubois/<server-name>:latest` (see
[`.github/workflows/docker-publish.yml`](./.github/workflows/docker-publish.yml)).
Installing it is then five steps: **image → config → tunnel → connector → verify.**

Using `mcp-journiv` as the worked example — substitute your server's name, port,
hostname, and env vars.

### 1. Prerequisite: the server must be in the publish workflow

Confirm the new server's folder name is in the `matrix.service` list in
`.github/workflows/docker-publish.yml`. If it isn't, add it, merge to `main`, and
wait for the **Publish Docker Images** action to go green — that's what creates
the `ghcr.io/...:latest` image the steps below pull.

### 2. Add the container in Unraid

Unraid's **Add Container** page has no "paste a template URL" box — the Template
field is a dropdown of templates it already knows about. So for a brand-new
server, just fill the form in by hand. The server folder's `unraid-template.xml`
is your **reference for exactly which fields to enter** (name, ports, paths,
variables, and their descriptions) — you read it while filling the form; you
don't have to import it.

**Fill the form manually (simplest):**
1. In Unraid: **Docker → Add Container**. Leave the **Template** dropdown as-is.
2. Set:
   - **Name** → `<server-name>` (e.g. `mcp-journiv`)
   - **Repository** → `ghcr.io/jeffreyrdubois/<server-name>:latest`
   - **Network Type** → `Bridge`, unless the server must reach another container
     by name (e.g. `mcp-journiv` → `http://journiv:8000`); then pick that
     container's Docker network instead, or stay on Bridge and point the
     upstream URL at the host IP (`http://192.168.x.x:8000`).
3. Use **Add another Path, Port, Variable, Label…** to add each of:
   - **Port** → Container `3000`, Host = the server's unique host port (see the table above), TCP
   - **Path** → Container `/config`, Host `/mnt/user/appdata/<server-name>` (persists config across updates)
   - **Variable** for each env var the server needs — always `OAUTH_CLIENT_ID` and
     `OAUTH_CLIENT_SECRET` (the OAuth pair below), plus that server's own
     credentials / upstream URL. The full list with descriptions is in the
     server's `unraid-template.xml` and `.env.example`.
4. **Apply.** Unraid pulls `ghcr.io/jeffreyrdubois/<server-name>:latest` and
   starts it — and **auto-saves your entries as a user template**, so next time
   the server *is* in the Template dropdown for quick edits.

**Prefer the template pre-filled in the dropdown?** Copy the server's
`unraid-template.xml` to `/boot/config/plugins/dockerMan/templates-user/`
(rename it e.g. `my-<server-name>.xml`). It then appears under **User templates**
in the Template dropdown with every field already populated. Optional — the
manual form fill above reaches the same place.

**Via compose (if you use the Compose Manager plugin instead):** copy the
server's `.env.example` to `.env`, fill it in, and `docker compose up -d`. Some
servers (like `mcp-journiv`) need to reach another container over an internal
Docker network — check that server's README for network notes.

> **The OAuth pair.** Every server is protected by a shared-style bearer token,
> not a login page (Anthropic's servers can't complete a browser redirect).
> - `OAUTH_CLIENT_ID` — a readable name, conventionally the server name (e.g. `mcp-journiv`).
> - `OAUTH_CLIENT_SECRET` — a long random string: `openssl rand -hex 32`.
>
> You reuse this same secret in step 4. Generate a **fresh** secret per server.
> Credentials are read from env on first run and saved to the AppData `/config`
> folder, so they survive container updates.

### 3. Add a cloudflared tunnel route

In your cloudflared config (the shared tunnel on the server — Zero Trust
dashboard or `config.yml`), add a public hostname pointing at the container:

```
journalmcp.<your-domain>   →   http://<container-name>:3000
```

e.g. `journalmcp.blackdogplex.com → http://mcp-journiv:3000`. cloudflared talks
to the container by **name on port 3000**, so the host-port mapping doesn't
matter here.

> **Access policy:** give MCP hostnames **no** Cloudflare Access policy — the
> `OAUTH_CLIENT_SECRET` is the boundary. (Upstream services like Journiv itself
> stay behind Access on their own hostnames; the MCP reaches them over the
> internal Docker network, never the public URL.)

### 4. Register the connector in Claude

In Claude → **Settings → Connectors → Add custom connector**:

- **URL:** `https://<hostname>/mcp` (e.g. `https://journalmcp.<your-domain>/mcp`)
- **Client ID:** your `OAUTH_CLIENT_ID`
- **Client secret:** your `OAUTH_CLIENT_SECRET`

Claude runs the OAuth handshake automatically and the tools appear.

### 5. Verify

```bash
curl https://<hostname>/health
```

Every server exposes `/health` and reports whether its upstream is configured,
e.g. `{"status":"ok","service":"mcp-journiv","configured":{"journiv":true},...}`.
Then ask Claude to use one of the new tools end-to-end.

---

## Building a brand-new server (not just installing one)

If you're adding a server from scratch, mirror an existing folder — they all
share the same shape:

```
mcp-<name>/
  src/index.ts          # McpServer over Express: /health, /mcp, OAuth endpoints
  package.json          # deps: @modelcontextprotocol/sdk, express, zod
  tsconfig.json
  Dockerfile            # node:20-alpine, multi-stage build
  docker-compose.yml    # unique host port, /config volume, healthcheck
  unraid-template.xml   # one <Config> per env var, with descriptions
  .env.example          # documents every env var
  .gitignore            # node_modules/ dist/ .env config/
  README.md             # server-specific setup
```

`mcp-mediamanager` (multiple upstreams) and `mcp-journiv` (JWT auth to an
upstream + a visibility allowlist + unit tests) are the fullest references.
Then: add the folder to the publish workflow matrix (step 1), open a PR, merge,
and follow the install runbook above.

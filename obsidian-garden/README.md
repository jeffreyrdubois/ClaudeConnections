# 🌱 obsidian-garden

A self-hosted, Cloudflare-fronted markdown garden for Unraid that gives you:

| Service | What it is | Host port |
| --- | --- | --- |
| **SilverBullet** (editable) | A browser-based wiki/editor for your notes, with wiki-links, backlinks, full-text search, and an Obsidian-style **graph / network map**. This is your editor — no separate app needed. | **4000** |
| **SilverBullet** (read-only) | An identical, *read-only* view of the same notes — your public "digital garden" front-end. Optional. | **4001** |
| **mcp-obsidian** | An MCP server so **Claude** can list, read, create, edit, move, delete, and search your notes. | **3004** |

All three share **one folder of plain `.md` files** (`./space`). Edit a note in the
browser and Claude sees it instantly; have Claude write a note and it appears in
the editor and the public view. No database, no lock-in — just markdown on disk.

> **Why SilverBullet instead of the forestry.md digital garden?** The forestry.md
> digital garden is *publish-only* (read-only) — it can't edit notes. You wanted
> an **editable** wiki *with* the network-map visualization, so SilverBullet is the
> better fit: it edits plain markdown in the browser, has the graph view you liked,
> and runs as a single self-hosted container. See the
> [digital garden plugin](https://github.com/oleeskild/obsidian-digital-garden)
> and [forestry.md](https://docs.forestry.md/) for the read-only approach.

---

## 1. Prerequisites

- Unraid with the **Docker Compose Manager** plugin (Community Apps), or any host
  with Docker + Docker Compose.
- A domain on **Cloudflare** (free plan is fine) for public access + login.

## 2. Quick start

```bash
# On your server (e.g. /mnt/user/appdata/obsidian-garden)
git clone https://github.com/jeffreyrdubois/ClaudeConnections.git
cd ClaudeConnections/obsidian-garden

cp .env.example .env
# Edit .env: set SB_USER, OAUTH_CLIENT_SECRET (openssl rand -hex 32), etc.
nano .env

# Make the notes + config folders owned by the same id the containers run as
# (Unraid default is 99:100 = nobody:users — match PUID/PGID in your .env):
mkdir -p space mcp-config
chown -R 99:100 space mcp-config

# Start the core stack (editable wiki + MCP server):
docker compose up -d

# …or include the public read-only garden and/or the Cloudflare tunnel:
docker compose --profile public --profile tunnel up -d
```

Then browse to:

- `http://YOUR-SERVER-IP:4000` — the editable wiki (log in with `SB_USER`).
- `http://YOUR-SERVER-IP:4001` — the read-only garden (only if you enabled `--profile public`).
- `http://YOUR-SERVER-IP:3004/health` — MCP health check (should return JSON).

> On Unraid you can instead paste `docker-compose.yml` into a Compose Manager
> stack and add the `.env` values as the stack's environment. The
> [`mcp-obsidian`](../mcp-obsidian) folder also ships an `unraid-template.xml`
> if you'd rather run the MCP server as a standalone Unraid container.

## 3. Turn on the graph / network map

SilverBullet's graph view ships as a plug. To enable the **Show Global Graph**
command (the Obsidian-like network map):

1. In the editable wiki, open the command palette (`Cmd/Ctrl-/`) and run
   **Plugs: Add**, then add the GraphView plug, e.g.:
   `github:zefhemel/silverbullet-graphview/graphview.plug.js`
2. Run **Plugs: Update**, reload the page.
3. Run **Show Global Graph**.

Backlinks and wiki-link navigation work out of the box without any plug. See the
[SilverBullet community Plugs & Libraries](https://community.silverbullet.md/c/plugs-and-libraries/)
for the GraphView and TreeView plugs and their latest install strings.

---

## 4. Cloudflare: public access + login

This is the part that makes everything safe on the public internet **and** lets
Claude connect to the MCP server (the bit that's been painful before).

### 4a. Create the tunnel

1. Cloudflare **Zero Trust** dashboard → **Networks → Tunnels → Create a tunnel**
   (type: *Cloudflared*).
2. Copy the tunnel **token** into `TUNNEL_TOKEN` in your `.env`, then start the
   `cloudflared` service: `docker compose --profile tunnel up -d`.
3. Under the tunnel's **Public Hostnames**, add three (point them at the internal
   container names — `cloudflared` is on the same compose network):

   | Public hostname | Service (URL) |
   | --- | --- |
   | `garden.example.com` | `http://silverbullet:3000` |
   | `read.example.com` *(optional)* | `http://silverbullet-readonly:3000` |
   | `mcp.example.com` | `http://mcp-obsidian:3004` |

### 4b. Protect the web UIs with login (browser OAuth)

For `garden.example.com` (and `read.example.com`): **Zero Trust → Access →
Applications → Add a self-hosted application**, set the domain, and add an
**Allow** policy that requires your identity (Email OTP, Google, GitHub, etc.).
Now anyone hitting those URLs must log in via Cloudflare before they ever reach
SilverBullet — and SilverBullet's own `SB_USER` login sits behind that as a
second layer.

### 4c. Protect the MCP endpoint with a **Service Token** (the fix)

The reason Claude has struggled with Cloudflare before: a normal Access policy
uses **browser-based OAuth**, which a headless client like Claude can't complete,
so it gets bounced to a Cloudflare login page instead of your MCP server. The fix
is a **Service Auth** policy backed by a **service token** — header-based auth
with no browser flow.

1. **Zero Trust → Access → Service Auth → Create Service Token.** Name it
   (e.g. `claude-mcp`). Copy the **Client ID** and **Client Secret** — the secret
   is shown only once.
2. **Add a self-hosted Access application** for `mcp.example.com`.
3. Add a policy to that application with **Action = `Service Auth`** (⚠️ *not*
   `Allow`) and the rule **Selector = "Service Token" → your `claude-mcp` token**.
   - Optional but recommended: keep a second `Allow` policy requiring your own
     identity so *you* can still open `mcp.example.com/health` in a browser.

Now requests to `mcp.example.com` are accepted **only** when they carry valid
`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers — exactly what we give
Claude below.

---

## 5. Connect Claude to the MCP server

Your MCP endpoint is: **`https://mcp.example.com/mcp`**

Claude needs to send, on every request:

- `CF-Access-Client-Id: <service-token client id>`
- `CF-Access-Client-Secret: <service-token client secret>` — to satisfy Cloudflare.
- `Authorization: Bearer <OAUTH_CLIENT_SECRET>` — to satisfy the MCP server's own
  auth (defense-in-depth; set in your `.env`).

### Claude Code / Claude Desktop / API (recommended — supports headers)

```bash
claude mcp add --transport http obsidian https://mcp.example.com/mcp \
  --header "CF-Access-Client-Id: <client-id>" \
  --header "CF-Access-Client-Secret: <client-secret>" \
  --header "Authorization: Bearer <OAUTH_CLIENT_SECRET>"
```

or in `claude_desktop_config.json` / an SDK config:

```jsonc
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "CF-Access-Client-Id": "<client-id>",
        "CF-Access-Client-Secret": "<client-secret>",
        "Authorization": "Bearer <OAUTH_CLIENT_SECRET>"
      }
    }
  }
}
```

### Claude.ai web "Custom Connector" (can't set custom headers)

The web connector UI only does OAuth — it can't attach the `CF-Access-*` headers,
so the Service Token won't apply there. If you must use the web connector, set the
`mcp.example.com` Access policy to **Bypass** instead of Service Auth, and rely on
the MCP server's built-in OAuth: it already serves `/.well-known/oauth-authorization-server`,
`/authorize`, and `/oauth/token`, so Claude.ai can complete the OAuth flow and use
your `OAUTH_CLIENT_SECRET` as the bearer. (The header-based Service Token path
above remains the more secure option for Claude Code / Desktop / API.)

### What Claude can do

`list_notes`, `read_note`, `create_note`, `update_note`, `append_note`,
`edit_note`, `move_note`, `delete_note`, `search_notes`. Reads are allowed for any
file in the vault; create/edit/delete are restricted to `NOTE_EXTENSIONS`
(default `.md,.markdown,.txt,.canvas`) and all paths are sandboxed to the vault
(no `../` escapes).

---

## 6. Updating & backups

```bash
docker compose pull        # get newer SilverBullet / cloudflared images
docker compose up -d --build   # rebuild the MCP image if you changed its source
```

Your data is just the `space/` folder of markdown — back it up like any other
folder (Unraid appdata backup, `restic`, `git`, etc.). The `mcp-config/` folder
only holds the MCP server's saved OAuth secret.

## 7. Security notes

- Don't expose ports 4000/4001/3004 directly to the internet — let the Cloudflare
  tunnel be the only public path. On Unraid, bind them to your LAN only if needed.
- Keep `SB_USER`, `SB_RO_USER`, `OAUTH_CLIENT_SECRET`, and the service token in
  `.env` (git-ignored) — never commit them.
- Rotate the service token and `OAUTH_CLIENT_SECRET` if they ever leak; restart
  the affected containers afterward.

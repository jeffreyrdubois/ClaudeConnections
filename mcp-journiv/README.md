# mcp-journiv

An MCP server that exposes your self-hosted [Journiv](https://github.com/journiv/journiv-app)
journal to Claude — so you can dictate entries conversationally and ask for
feedback on things you're working through — while keeping almost everything
private by default.

**Only entries you have tagged `ai` are visible to Claude.** Everything else in
your journal does not exist as far as this server is concerned. Exposure is a
deliberate, opt-in act.

Built to match the other servers in this repo: TypeScript + `@modelcontextprotocol/sdk`
over Express, the same OAuth handshake that fronts the other connectors, config
persisted to `/config`, and a matching Unraid template.

```
Claude  →  journalmcp.<your-domain>  →  [cloudflared tunnel]
        →  mcp-journiv container  →  http://journiv:8000/api/v1  (internal Docker network)
```

- Journiv runs on Unraid (SQLite backend) behind Cloudflare Access at its own hostname.
- The MCP container reaches Journiv over the **internal** Docker network. Journiv is never reached via the MCP's public hostname.
- The MCP hostname gets **no Access policy** — Anthropic's servers can't complete a browser auth redirect. The `OAUTH_CLIENT_SECRET` bearer token is the boundary.

## Tools

| Tool | What it does |
|---|---|
| `list_recent` | Most recent N visible (`ai`-tagged) entries |
| `get_entry` | One entry in full, by id **or** by date |
| `search_entries` | Full-text search, restricted to visible entries |
| `create_entry` | Create an entry — **automatically tagged `ai`** |
| `append_to_entry` | Append text to an existing visible entry |
| `update_entry` | Replace the body text (and optionally title) of a visible entry |

There is **no delete tool** by design — manual deletion in the Journiv UI is
always better. There are also no mood/analytics tools in v1 (see
[Analytics leakage](#analytics-leakage-why-no-mood-tools)).

## The visibility model (read this)

The allowlist is enforced at a **single choke point**, not per tool, so adding a
seventh tool later can't accidentally leak. Both enforcement paths **fail
closed** — the design bias is "show nothing" over "leak everything":

- **`isVisible(moment)`** (`src/visibility.ts`) decides visibility for a fully
  hydrated moment. If the `tags` field is missing or isn't an array — e.g. a
  Journiv upgrade renamed or restructured it — it returns `false` (private),
  never `true`.
- **`visibleMomentIds()`** (`src/index.ts`) is the server-side source of truth,
  from `GET /tags/{id}/moments`. List and search results are filtered against
  this set. If the `ai` tag can't even be resolved (tag system renamed), the set
  is empty and nothing is visible.

Other guarantees:

- **`create_entry` always applies `ai`** — so you can see the MCP's prior entries
  for continuity, and every AI-authored entry is visibly marked in the Journiv UI.
- **No write path can touch the `tags` array.** `update_entry` and
  `append_to_entry` go through `PUT /entries/{id}`, whose schema has no tags
  field at all — the boundary is structural, not just "we remembered not to."
  Tag changes happen in the Journiv UI only.
- **Requesting a non-visible entry returns "not found," not "access denied,"** so
  the existence and dates of private entries can't be enumerated by probing ids.
- **Search doesn't under-return.** Journiv's `/moments` list has no server-side
  tag filter, so naive "fetch one page, filter client-side" would make a real
  match look like "no results." Instead we intersect search hits (paged) with the
  authoritative visible-id set, bounded by a crawl cap (`truncated: true` flags
  when the cap is hit on a very large journal).

The security-critical logic lives in `src/visibility.ts` and has unit tests
covering every acceptance criterion (`npm test`).

## How this maps onto Journiv's real API

Journiv's data model isn't quite "entries with tags." The tools above hide these
details, but for maintenance:

- The unit shown to Claude as an "entry" is a Journiv **moment**
  (`/api/v1/moments/{id}`). A moment *embeds* an entry body plus `note`, `tags`,
  mood, people, media, and a logged date.
- **Tags live on the moment** (`moment.tags`), added via
  `POST /moments/{id}/tags` (body: a bare JSON array like `["ai"]`).
- The moment response only carries a **truncated** body preview. The full body is
  a Quill **Delta** on the entry (`GET /entries/{entry_id}` → `content_delta`);
  `create_entry`/`update_entry`/`append_to_entry` convert between plain text and
  Delta at the boundary. Media/embed inserts are dropped from the text view.
- Auth: `POST /auth/login` (`{email, password}`) → `access_token` + `refresh_token`;
  the server caches the JWT and refreshes on 401.

### Keep `journiv-api.json` current

Journiv is pre-1.0 — the API is the closest thing to a contract, and the DB
schema is an implementation detail (**do not read SQLite directly**). Pull and
commit the spec, then diff it after every Journiv upgrade:

```bash
JOURNIV_URL=http://localhost:8000 ./scripts/pull-openapi.sh
git add journiv-api.json && git commit -m "Update Journiv OpenAPI snapshot"
```

A meaningful diff to `/moments`, `/entries`, `/tags`, or `/auth` is your
early-warning that this MCP may need updating. (The spec isn't committed here yet
because it must come from your running instance.)

### Analytics leakage — why no mood tools

Journiv's mood/analytics endpoints aggregate across **all** entries, so an
untagged entry's mood could surface in a chart even though its text is filtered.
v1 deliberately omits analytics tools rather than risk that leak. Revisit only if
those endpoints can be scoped by tag.

### Media — out of scope for v1

Entries with photos proxy through signed URLs. The text view drops media inserts;
the MCP does not surface image references. Decide later whether it should.

## Deploy

For the generic install flow shared by every server in this repo
(image → config → tunnel → connector → verify), see the
**[install runbook in the root README](../README.md#how-to-install-a-new-mcp-server-on-unraid)**.
The Journiv-specific steps below layer on top of it.

These steps run on your server — this repo ships the code, image, and templates.

1. **Create a dedicated Journiv account for the MCP** (not your personal login),
   then re-disable signups in Journiv. Revoking the connector should never require
   changing your own password.
2. **Configure** — copy `.env.example` to `.env` and fill it in (or set the
   equivalent fields in the Unraid template). `JOURNIV_URL` is Journiv's
   **internal** address, `OAUTH_CLIENT_SECRET` is a long random string
   (`openssl rand -hex 32`).
3. **Networking** — the MCP container must reach Journiv over the internal
   network. With `docker-compose`, it joins Journiv's network (`journiv_default`
   by default — check `docker network ls` and adjust). On Unraid, either attach it
   to Journiv's Docker network or set `JOURNIV_URL` to the host IP
   (`http://192.168.x.x:8000`).

   > **"Invalid host header"?** Journiv (Starlette `TrustedHostMiddleware`) only
   > accepts requests whose `Host` matches its configured public hostname
   > (`DOMAIN_NAME`), which is a **single** value — adding a second `DOMAIN_NAME`
   > breaks the public one. So don't try to whitelist the internal IP in Journiv.
   > Instead set **`JOURNIV_HOST_HEADER`** to Journiv's public hostname (just the
   > host, e.g. `journal.your-domain.com`). The MCP still connects to `JOURNIV_URL`
   > (the internal IP) but presents that trusted `Host`, so Journiv accepts it —
   > no Journiv config change. Leave it unset if `JOURNIV_URL`'s host is already
   > trusted (e.g. reaching `http://journiv:8000` on the shared Docker network).
4. **Run:**
   ```bash
   docker compose up -d --build
   ```
5. **Tunnel** — add a cloudflared route `journalmcp.<your-domain>` →
   `http://mcp-journiv:3000` (managed by the shared `cloudflared/` container).
   Give this hostname **no** Cloudflare Access policy.
6. **Register in Claude** as a custom/remote MCP connector:
   - URL: `https://journalmcp.<your-domain>/mcp`
   - Client ID: `mcp-journiv` (or your `OAUTH_CLIENT_ID`)
   - Client secret: your `OAUTH_CLIENT_SECRET`

Health check: `GET https://journalmcp.<your-domain>/health`.

## Develop

```bash
npm install
npm run dev     # tsx, live reload
npm test        # unit tests for the visibility allowlist + Delta conversion
npm run build   # tsc -> dist/
```

## Acceptance criteria (from issue #77)

- [x] An entry with no tags is invisible to every tool, including search
- [x] An entry tagged `ai` is readable
- [x] Entries created via MCP carry the `ai` tag automatically
- [x] `update_entry` cannot alter tags (routes through `PUT /entries`, which has no tags field)
- [x] Requesting a non-visible entry by ID returns not-found, not a permission error
- [x] Simulating a renamed `tags` field returns zero entries, not all entries (unit-tested)
- [x] Search across a large journal doesn't under-return due to pagination + filtering
- [x] Journiv's own hostname remains behind Cloudflare Access (deployment: MCP hostname is separate and unprotected-by-Access-but-token-guarded)

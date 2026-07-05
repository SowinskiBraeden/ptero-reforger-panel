# Reforger Panel

A private, purpose-built control panel for one community Arma Reforger training/recruiting server. It sits **on top of Pterodactyl** — Pterodactyl (and Wings) keep running the game container, files, backups, and allocations; this panel is the curated management experience for the owner and trusted crew admins.

Not included by design: billing, public sign-up, multi-tenancy, arbitrary file management, raw console access, or anything that replaces Pterodactyl.

## Architecture

```text
Browser (React SPA)
  │  same-origin /api only — no upstream credentials ever reach the browser
  ▼
Panel API (Express + TypeScript)
  ├─ Discord OAuth → local users, sessions (Postgres), roles
  ├─ PostgreSQL (Drizzle ORM)
  ├─ Workshop client → https://api.reforgermods.net (backend-only)
  ├─ GameServerProvider abstraction
  │     ├─ PterodactylProvider (Client API: status, resources, power, read-only files)
  │     └─ MockGameServerProvider (full local dev without credentials)
  └─ Log ingestion worker: Pterodactyl log download → parser → players/sessions/events
```

Monorepo layout:

```text
apps/api        Express API, Drizzle schema/migrations, ingestion worker, tests
apps/web        Vite + React + Tailwind dashboard
packages/shared Roles/capabilities, DTO types, Reforger config model
```

## Quick start (mock mode, no Pterodactyl or Discord needed)

```bash
cp .env.example .env            # defaults are fine for local dev
# set DEV_AUTH_BYPASS=true in .env to log in without Discord

docker compose up -d            # Postgres on 127.0.0.1:5433
npm install
npm run db:migrate
npm run db:seed                 # creates the server row (real data is imported from the server)
npm run dev                     # API on :3001, web on :5173
```

Open http://localhost:5173 and use **Local development login** (requires `DEV_AUTH_BYPASS=true`; the endpoint refuses to exist in production). Mock mode serves a generated `console.log`, so within ~20 s the dashboard shows players, sessions, and events produced by the real ingestion pipeline.

Useful scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format`, `npm run db:generate` (new migration after schema changes).

## Environment variables

See `.env.example` for the full annotated list. Highlights:

| Variable                                                                              | Purpose                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`, `SESSION_SECRET`                                                      | Postgres + cookie/state signing (32+ chars)                                    |
| `DISCORD_CLIENT_ID/SECRET`, `DISCORD_REDIRECT_URI`                                    | Discord OAuth app                                                              |
| `OWNER_DISCORD_ID`                                                                    | This Discord account is auto-assigned `owner` at login                         |
| `DEV_AUTH_BYPASS`                                                                     | Local-only fake owner login; rejected when `NODE_ENV=production`               |
| `REFORGER_WORKSHOP_API_BASE_URL`                                                      | Workshop metadata API (backend-only)                                           |
| `PTERODACTYL_BASE_URL`, `PTERODACTYL_CLIENT_API_KEY`, `PTERODACTYL_SERVER_ID`         | Client API (not Application API)                                               |
| `USE_MOCK_PTERODACTYL`                                                                | `true` = run entirely against the in-process mock                              |
| `REFORGER_CONFIG_PATH`, `REFORGER_CONFIG_SYNC_INTERVAL_SECONDS`                       | Where the server's config.json lives; imported read-only at startup + interval |
| `REFORGER_LOG_DIRECTORY`, `REFORGER_LOG_FILE_PATTERN`                                 | Recommended: directory listed each sync; newest `logs_*` subfolder is followed |
| `REFORGER_ADMIN_LOG_PATH`                                                             | Optional: pins one exact log file, overriding directory discovery              |
| `REFORGER_LOG_POLL_INTERVAL_SECONDS` / `_MAX_DOWNLOAD_BYTES` / `_STALE_AFTER_SECONDS` | Ingestion pacing, download cap, staleness threshold                            |

Environment is validated with zod at startup; the process refuses to boot with missing/contradictory settings (e.g. real mode without Pterodactyl credentials).

## Users, roles, and enforcement

Roles live in the panel database (not Discord roles). New users default to `viewer`; the account matching `OWNER_DISCORD_ID` becomes `owner` automatically. The owner manages roles under **Settings**.

| Capability                             | owner | server_admin | mission_lead | viewer |
| -------------------------------------- | :---: | :----------: | :----------: | :----: |
| View dashboard/server/players/activity |   ✓   |      ✓       |      ✓       |   ✓    |
| Start / stop                           |   ✓   |      ✓       |      —       |   —    |
| Restart                                |   ✓   |      ✓       |      ✓       |   —    |
| Operational health diagnostics         |   ✓   |      ✓       |      —       |   —    |
| Manual log sync                        |   ✓   |      —       |      —       |   —    |
| User/role management, settings         |   ✓   |      —       |      —       |   —    |

Enforcement is backend middleware (`requireAuth` + `requireCapability`); the frontend only hides buttons. Sessions are 7-day HTTP-only cookies (`SameSite=Lax`, `Secure` in production), stored in Postgres as SHA-256 hashes and revocable server-side. State-changing requests additionally require a custom `X-CSRF-Protection` header and pass an Origin allowlist; OAuth uses a signed `state` cookie. Auth, power, and sync endpoints are rate limited.

## Log ingestion

Flow: panel backend → Pterodactyl Client API (signed download URL, streamed with a byte cap) → parser → Postgres. Wings is never touched directly and the browser never downloads logs.

- **Scheduler** — one poll loop per server (default 20 s), per-server lock so syncs never overlap, exponential backoff (up to 8×) after consecutive failures, graceful shutdown that waits for in-flight syncs. Starts only when a provider and log path are configured. Owner can trigger `POST /api/servers/:slug/logs/sync` manually.
- **Cursoring** — a `log_cursors` row per (server, path) stores byte offset, file fingerprint (hash of the first line when visible), hash of the last processed line, and any partial trailing line.
  - _First sync_: only a bounded tail (512 KiB) is imported, never full history.
  - _Append_: only bytes after the cursor are parsed; a stored partial line is prepended.
  - _Rotation/truncation/replacement_: detected via size decrease, fingerprint change, or a continuity mismatch at the cut point → cursor resets and a bounded tail of the new file is processed.
  - _Partial trailing lines_ are never parsed; they wait for the next sync.
  - _Large files_: downloads are capped (`REFORGER_LOG_MAX_DOWNLOAD_BYTES`); if the file grew past the window, the gap is noted and a bounded tail is processed. Retrieval is isolated in `pterodactyl-log-source.ts` so range/tail requests can be added without touching parsing.
- **Deduplication** — events carry a unique `(server_id, source_log_path, sha256(raw line))` key enforced by a Postgres unique index, so rotation boundaries and cursor resets cannot double-import.
- **Sessions** — connect opens a session; disconnect closes it with duration; a reconnect without a disconnect closes the stale session (`missed_disconnect`); a fresh server start closes all open sessions (`server_restart`) and emits `server_restart_detected`.

### Supported log events and known limitations

Recognized today (patterns centralized in `apps/api/src/modules/reforger-logs/parser/patterns.ts`, verified against real server logs):

- `Player #N Name (ip:port) connected` (BattlEye wrapper) → `player_connected`
- `Player #N Name disconnected` → `player_disconnected`
- `Player #N Name - BE GUID: …` → merged into the player as a stable identity
- `Authenticated player: … identityId=<uuid> name=<name>` (BACKEND channel) → engine-level identity, available even without BattlEye
- `Game successfully created` / `Server is ready to accept connections` → `server_started`

When both identity lines appear for a player, the first one wins and the other is ignored, so a player is never split into duplicates.

Limitations to keep in mind:

- **Patterns can change between game versions.** They were validated against a live 2026 server log, but Bohemia can change the format; adjust `patterns.ts` (each pattern has a fixture-backed test).
- **Player identity**: when logs provide no GUID, players are matched by display name only — two people with the same name would merge, and renames create a new player record. The GUID line, when present, upgrades matching to a stable ID.
- **Timestamps** in Reforger logs are time-of-day only; the date comes from the `Log started` header or falls back to the sync date, with midnight-rollover and future-timestamp guards. Cross-midnight logs without a header can be off by a day in pathological cases.
- Player data is **log-polled, not real-time** — the UI always shows "last synchronized" and flags staleness rather than pretending to be live.

### Finding the log location in Pterodactyl

Open your server in Pterodactyl → **Files**. Reforger writes a new dated folder per boot (e.g. `/profile/logs/logs_2026-07-04_12-54-04/console.log`). Set `REFORGER_LOG_DIRECTORY` to the parent (e.g. `/profile/logs`) — the panel lists it on every sync and follows the newest `logs_*` folder automatically, so restarts need no reconfiguration. `REFORGER_ADMIN_LOG_PATH` exists to pin one exact file and overrides discovery.

### Configuration import

The panel downloads the server's real `config.json` (default `/config.json`, override with `REFORGER_CONFIG_PATH`) at startup, every `REFORGER_CONFIG_SYNC_INTERVAL_SECONDS`, and on demand via **Configurations → Sync from server** (owner/server admin). Each change creates a new `ConfigRevision`, and the server's displayed name and max players always come from the imported config — nothing is hand-seeded. Credentials in config.json (admin password, RCON password) are never copied into the panel's model.

## Deploying privately (you + friends)

The API serves the built web app itself in production, so the whole panel is one container plus Postgres:

```bash
cp .env.example .env    # set Discord creds, OWNER_DISCORD_ID, Pterodactyl vars,
                        # a fresh SESSION_SECRET (openssl rand -base64 32),
                        # USE_MOCK_PTERODACTYL=false, DEV_AUTH_BYPASS=false
docker compose -f docker-compose.prod.yml up -d --build
```

Then put HTTPS in front of port 3001 — any of:

- **Tailscale** (easiest for a private group): `tailscale serve https / http://localhost:3001`, share the tailnet with your friends.
- **Caddy**: `reverse_proxy localhost:3001` with a domain (automatic HTTPS).
- **nginx + certbot** if you already run it.

Finally set `WEB_ORIGIN` and `DISCORD_REDIRECT_URI` in `.env` to the public URL (e.g. `https://panel.example.com` and `https://panel.example.com/api/auth/discord/callback`), register that redirect URI in your Discord application, and restart the stack. Production mode enforces `Secure` cookies (HTTPS required), refuses `DEV_AUTH_BYPASS`, and requires Discord credentials at boot.

Access model for a private group: anyone with the URL can log in with Discord but lands as a **viewer** with read-only access; hand out **invite links** (Settings → Invites) to grant server admin / mission lead roles, and manage roles under Settings → Users.

## Connecting a real Pterodactyl server safely

1. In Pterodactyl, log in as a user that has access to **only** this game server (create a dedicated sub-user if needed).
2. Account Settings → API Credentials → create a **Client API** key. This scopes the panel to that user's servers — do not use an admin/Application API key.
3. Set `PTERODACTYL_BASE_URL`, `PTERODACTYL_CLIENT_API_KEY`, `PTERODACTYL_SERVER_ID` (the short identifier from the server URL), `USE_MOCK_PTERODACTYL=false`, and `REFORGER_ADMIN_LOG_PATH`.
4. Update the seeded server row if needed (the seed stores `PTERODACTYL_SERVER_ID` when present).
5. Restart the API and check **Settings → Integrations** and the dashboard's Operational health card.

The API key stays server-side; requests have 10–30 s timeouts, size-capped downloads, and errors are sanitized (no key, no host, no stack traces) before storage or display.

## API surface

```text
GET  /api/auth/me           POST /api/auth/logout
GET  /api/auth/discord      GET  /api/auth/discord/callback
POST /api/auth/dev-login    (dev only)

GET  /api/servers                         GET /api/servers/:slug
GET  /api/servers/:slug/resources         GET /api/servers/:slug/players
GET  /api/servers/:slug/players/known     GET /api/servers/:slug/activity
GET  /api/servers/:slug/configuration     GET /api/servers/:slug/mod-packs
POST /api/servers/:slug/power/{start,stop,restart}
POST /api/servers/:slug/logs/sync         GET /api/servers/:slug/logs/health

GET  /api/workshop/health   GET /api/workshop/search?q=&page=&sort=
GET  /api/workshop/mods/:id

GET  /api/users             PATCH /api/users/:id/role      (owner only)
```

Errors are structured: `{ "error": { "code", "message", "requestId" } }`.

## Implemented vs scaffolded

**Implemented**: Discord OAuth + sessions + role enforcement, dashboard + server pages, provider abstraction with mock and real Pterodactyl Client API, power controls with per-role limits (audited to the activity feed, simulated in mock mode), Workshop health/search/detail proxy, read-only config preview + revision history, full log ingestion pipeline (scheduler, cursoring, rotation, dedupe, sessions), operational health card, owner user/role management, 63 tests.

**Scaffolded / later phases**: mod-pack editing and deployment ("Add to pack" is intentionally disabled), config generation/writing to the server (no file writes through Pterodactyl yet), config presets for mission leads, Discord-role sync, multi-server support (schema is ready; UI assumes one), historical playtime analytics.

**Recommended next steps**: (1) capture real `console.log` samples from your server and harden the parser fixtures; (2) mod-pack builder writing `ModPackRevision`s from Workshop search; (3) config generation producing a real `config.json` diff/preview from `ConfigRevision`, then a guarded deploy (file write + restart) for owner/server admin; (4) preset selection for mission leads; (5) session-history charts from `player_sessions`.

# Reforger Panel

Reforger Panel is a private web control panel for an Arma Reforger server hosted through Pterodactyl. It gives trusted server staff a focused interface to watch the server live, manage the mod list, edit `config.json` safely, pick a mission, review player activity, and run power actions — without exposing Pterodactyl credentials to the browser.

The panel is intended for one private community server. It is not a replacement for Pterodactyl and does not provide billing, public signup, raw console access, arbitrary file management, or multi-tenant hosting.

## What it does

- **Live console.** The panel proxies Pterodactyl's Wings websocket, so the Console page shows
  output from the moment you press Start — container pull, SteamCMD update, mod downloads, then
  the game itself. The same feed drives the CPU/memory/network/disk numbers, so they match what
  Pterodactyl reports rather than lagging a poll behind.
- **Mod manager.** Backed by the reforgermods.net **v2** API. Add and remove mods, pin a version
  from the published version list (or type one in), resolve dependencies, update one mod or all of
  them, clear the list, or copy a modlist off any live server in the public server browser. Edits
  are staged as a reviewable diff and written to `config.json` once.
- **Configuration.** Typed, range-validated cards for the settings the panel understands, a
  searchable view of _every_ key the file actually contains, and a raw JSON editor. Only the fields
  you touch are written, writes are serialised and verified by reading the file back, and a write
  based on a stale copy is rejected instead of silently reverting someone else's change. Keys that
  a Reforger egg re-templates from a startup variable are flagged, with an option to write both.
- **Mission select.** One list of the vanilla scenarios plus one group per installed mod that ships
  missions, with a warning when the configured scenario is no longer provided by anything.

## Project Structure

```text
apps/api        Express API, database schema, auth, Pterodactyl integration, log ingestion
apps/web        Vite, React, and Tailwind dashboard
packages/shared Shared roles, DTOs, and Reforger configuration types
```

## Requirements

- Node.js 22 or newer
- npm
- Docker, for the local Postgres database
- Discord application credentials, only when using real Discord login
- Pterodactyl Client API credentials, only when connecting to a real server
- Outbound access to `api.reforgermods.net` for Workshop metadata (backend only)

## Local Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. For local development without Discord or Pterodactyl, set these values in `.env`:

```env
DEV_AUTH_BYPASS=true
USE_MOCK_PTERODACTYL=true
```

3. Start Postgres:

```bash
docker compose up -d
```

4. Install dependencies and prepare the database:

```bash
npm install
npm run db:migrate
npm run db:seed
```

## Launch Locally

Start the API and web app:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

When `DEV_AUTH_BYPASS=true`, use the local development login. The API runs on port `3001`; the web app runs on port `5173`.

## Production Launch

1. Copy and edit the environment file:

```bash
cp .env.example .env
```

2. Set production values in `.env`:

```env
NODE_ENV=production
DEV_AUTH_BYPASS=false
USE_MOCK_PTERODACTYL=false
SESSION_SECRET=<long-random-secret>
WEB_ORIGIN=https://your-panel-domain.example
DISCORD_REDIRECT_URI=https://your-panel-domain.example/api/auth/discord/callback
DISCORD_CLIENT_ID=<discord-client-id>
DISCORD_CLIENT_SECRET=<discord-client-secret>
OWNER_DISCORD_ID=<your-discord-user-id>
PTERODACTYL_BASE_URL=<pterodactyl-url>
PTERODACTYL_CLIENT_API_KEY=<client-api-key>
PTERODACTYL_SERVER_ID=<server-id>
```

3. Start the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

4. Put HTTPS in front of port `3001` with a reverse proxy such as Caddy, nginx, or Tailscale Serve.

## Connecting Pterodactyl

Use a Pterodactyl Client API key from an account that only has access to the intended Arma Reforger server. Do not use a Pterodactyl Application API key.

Recommended log configuration:

```env
REFORGER_LOG_DIRECTORY=/profile/logs
REFORGER_LOG_FILE_PATTERN=console.log
```

The panel follows the newest `logs_*` folder during sync. If you need to pin a single file instead, set `REFORGER_ADMIN_LOG_PATH`.

Log ingestion feeds player sessions and the killfeed only. The Console page does not depend on it —
it reads Pterodactyl's websocket directly, which is why it can show the install and mod-download
phases that never reach the game's own log file. That relay needs `PTERODACTYL_WEBSOCKET_ENABLED=true`
(the default) and a client API key with websocket access to the server.

## Common Commands

```bash
npm run dev          # Start API and web app in development mode
npm run build        # Build all workspaces
npm run typecheck    # Run TypeScript checks
npm run lint         # Run ESLint
npm test             # Run tests
npm run db:migrate   # Apply database migrations
npm run db:seed      # Seed initial server data
```

## Notes

- `config.json` is read live on every request and written in place; the previous contents are always
  kept as `config.json.bak`.
- Workshop metadata is cached in the API process with stale-while-revalidate and request pacing, so
  the Mods page is fast and the upstream rate limit is never approached. There is no background
  polling of reforgermods.net — it is queried on demand only.
- Roles are stored in the panel database.
- New Discord users start as viewers.
- The Discord account matching `OWNER_DISCORD_ID` becomes the owner.
- Pterodactyl credentials are used only by the backend.
- The browser only calls the panel API.
- Production mode requires HTTPS because secure cookies are enabled.

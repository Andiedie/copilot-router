# copilot-router

A reverse proxy that multiplexes GitHub Copilot API requests across multiple GitHub accounts with load balancing and quota management. Point any Copilot-compatible client at this service without changing anything else.

## Features

- **Multi-account round-robin** — weighted rotation across active accounts, prioritizing those with more remaining quota
- **Transparent JWT refresh** — Copilot JWTs are cached in-process and refreshed proactively before expiry; concurrent requests share a single refresh
- **Account management** — add accounts via GitHub OAuth Device Flow, no manual token handling
- **Quota tracking** — syncs `premium_interactions` quota from the GitHub API per account
- **Request logging** — records account, model, status code, and latency per request
- **Admin UI** — built-in web console at `/admin/` for managing accounts, API keys, and viewing stats

## Getting Started

**Requirements**: [Bun](https://bun.sh) >= 1.0

```bash
git clone <repo>
cd copilot-router

cp .env.example .env
# edit .env — ADMIN_TOKEN is required

bun install
bun run db:migrate
bun run dev
```

Open `http://localhost:4141/admin/` to access the admin console.

## Docker

```bash
# docker compose (recommended)
ADMIN_TOKEN=your-secret docker compose up -d
```

```bash
# docker run
docker run -d \
  --name copilot-router \
  --restart unless-stopped \
  -p 4141:4141 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_TOKEN=your-secret \
  ghcr.io/andiedie/copilot-router:latest
```

The database is stored in `./data/` on the host, mounted to `/app/data` in the container.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_TOKEN` | ✅ | — | Admin API bearer token. Process exits at startup if missing. |
| `PORT` | | `4141` | Listening port |
| `DB_PATH` | | `./data/copilot-router.db` | SQLite database path |
| `GITHUB_CLIENT_ID` | | built-in default | GitHub App client ID for OAuth Device Flow |
| `COPILOT_API_BASE` | | `https://api.githubcopilot.com` | Copilot API upstream base URL |
| `GITHUB_API_BASE` | | `https://api.github.com` | GitHub API base URL (used for quota sync) |
| `TOKEN_REFRESH_BUFFER` | | `0.8` | Refresh JWT when `now >= expiresAt * buffer` (i.e. at 80% of lifetime) |
| `TEST_MODEL` | | `gpt-5-mini` | Model used for account health checks (does not consume premium quota) |

## Adding Accounts

Go to the **Accounts** page in the Admin UI and click **Authorize**. Follow the GitHub Device Flow prompt to authorize in your browser.

## Client Setup

Create an API key on the **API Keys** page in the Admin UI, then point your client at this service:

```
baseURL: http://localhost:4141/v1
Authorization: Bearer <your-api-key>
```

For opencode users, the API Keys detail page has a button to copy a ready-to-paste config snippet.

## Development

```bash
bun run dev          # hot-reload dev server
bun run db:generate  # generate migration after schema changes
bun run db:migrate   # apply pending migrations
```

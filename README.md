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

| Variable                | Default                         | Description                                                            |
|-------------------------|---------------------------------|------------------------------------------------------------------------|
| `ADMIN_TOKEN`           | `test`                          | Admin API bearer token. Process exits at startup if missing.           |
| `PORT`                  | `4141`                          | Listening port                                                         |
| `DB_PATH`               | `./data/copilot-router.db`      | SQLite database path                                                   |
| `GITHUB_CLIENT_ID`      | built-in default                | GitHub App client ID for OAuth Device Flow                             |
| `COPILOT_API_BASE`      | `https://api.githubcopilot.com` | Copilot API upstream base URL                                          |
| `GITHUB_API_BASE`       | `https://api.github.com`        | GitHub API base URL (used for quota sync)                              |
| `TOKEN_REFRESH_BUFFER`  | `0.8`                           | Refresh JWT when `now >= expiresAt * buffer` (i.e. at 80% of lifetime) |
| `TEST_MODEL`            | `gpt-5-mini`                    | Model used for account health checks (does not consume premium quota)  |

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

## Debug Test Model

A built-in test model `__test_model__` bypasses Copilot API forwarding entirely, returning mock responses with configurable delays. Useful for diagnosing connection timeout/reset issues across the proxy chain (Bun → reverse proxy → CDN → client).

**Model name format:**

| Model | Total Duration | Stream Interval |
|-------|---------------|-----------------|
| `__test_model__` | 300s (5min) | 10s |
| `__test_model__30__` | 30s | 10s |
| `__test_model__30_5__` | 30s | 5s |

**Non-streaming** — waits for the full duration, then returns a single JSON response:

```bash
curl -v POST https://your-host/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"__test_model__30__","messages":[{"role":"user","content":"test"}]}'
```

**Streaming** — sends one SSE chunk per interval for the full duration:

```bash
curl -v -N POST https://your-host/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"__test_model__300_30__","messages":[{"role":"user","content":"test"}],"stream":true}'
```

Server logs every lifecycle event (`[test-model]` prefix): request start, each chunk sent, client disconnect, completion. See [DEPLOYMENT.md](DEPLOYMENT.md) for known Cloudflare timeout behavior.

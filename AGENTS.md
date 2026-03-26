# AGENTS.md — copilot-router

**Generated:** 2026-03-27
**Branch:** main

## OVERVIEW

Load-balancing reverse proxy that multiplexes GitHub Copilot API requests across multiple GitHub accounts. Built with Bun + Hono + Drizzle ORM on SQLite.

## STRUCTURE

```
copilot-router/
├── src/index.ts          # Entry point: Hono app, route mounting, Bun.serve
├── src/config.ts         # Env vars + side effects (mkdir data/, throws if ADMIN_TOKEN missing)
├── src/account/          # Account CRUD, JWT token cache, pool selection (round-robin)
├── src/auth/             # Bearer API key validation middleware
├── src/proxy/            # Request forwarding to api.githubcopilot.com
├── src/admin/            # Admin REST API + HTML dashboard (no auth on HTML shell)
├── src/db/               # Drizzle ORM setup, schema, migration runner
├── src/quota/            # Quota syncing from GitHub API + account health test
├── src/stats/            # Analytics queries (raw SQL via drizzle sql.raw)
├── drizzle/              # Migration SQL + snapshot JSON
└── data/                 # SQLite DB files (git-ignored, created at startup)
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add a proxy feature / modify forwarding | `src/proxy/index.ts` |
| Change which headers reach upstream | `src/proxy/headers.ts` — PASSTHROUGH_HEADERS list |
| Account selection algorithm | `src/account/pool.ts` — `selectAccount()` |
| JWT token refresh / caching | `src/account/token.ts` — in-memory Map, in-flight dedup |
| OAuth device flow (add account) | `src/account/oauth.ts` |
| Admin API routes | `src/admin/routes.ts` |
| DB schema changes | `src/db/schema.ts` → run `bun run db:generate && bun run db:migrate` |
| Add analytics query | `src/stats/index.ts` |
| Quota sync logic | `src/quota/index.ts` |
| Environment config | `src/config.ts` + `.env.example` |

## CODE MAP

| Symbol | File | Role |
|--------|------|------|
| `proxyHandler` | `src/proxy/index.ts` | Core request forwarder; strips `/v1` prefix, selects account, gets JWT, calls upstream |
| `selectAccount` | `src/account/pool.ts` | Weighted round-robin; accounts within 80% of best quota are candidates |
| `getToken` | `src/account/token.ts` | In-memory JWT cache with in-flight dedup to avoid parallel refresh races |
| `exchangeToken` | `src/account/token.ts` | OAuth token → Copilot JWT via `/copilot_internal/v2/token` |
| `bearerAuth` | `src/auth/middleware.ts` | Validates client API keys; skips `/admin` paths |
| `sanitizeAccount` | `src/admin/routes.ts` | Strips `oauth_token` from all account API responses |
| `syncAccountQuota` | `src/quota/index.ts` | Fetches `premium_interactions` from `/copilot_internal/user`; `quota_limit=-1` means unlimited |
| `buildUpstreamHeaders` | `src/proxy/headers.ts` | Injects Copilot identity headers; only whitelisted client headers pass through |
| `logRequest` | `src/proxy/logger.ts` | Fire-and-forget DB insert (void async); records model, status, duration; never blocks response |
| `db` | `src/db/index.ts` | Singleton Drizzle + bun:sqlite; WAL mode, NORMAL sync |

## CONVENTIONS

- **Runtime**: Bun (not Node.js). Use `bun:sqlite`, `Bun.file()`, `Bun.serve()` — not Node equivalents.
- **tsconfig `noEmit: true`**: Bun runs TypeScript directly. No compile step.
- **Timestamps**: Unix epoch in seconds (`Math.floor(Date.now() / 1000)`), stored as `integer`.
- **IDs**: `nanoid()` for all primary keys.
- **DB field names**: snake_case in schema and raw SQL. TypeScript variables use camelCase.
- **Error returns**: Async functions return `{ success: true, ... } | { success: false, error: string }` union — not throws.
- **Auth bypass**: `/admin` paths are explicitly skipped in `bearerAuth` middleware; admin auth happens inside `adminApp` via `ADMIN_TOKEN`.
- **`(c as any).set()`**: Hono context has no typed extension points — cast to `any` when setting/getting custom keys.

## ANTI-PATTERNS (THIS PROJECT)

- **Never expose `oauth_token`** in API responses — always use `sanitizeAccount()`.
- **Never `await` `logRequest()`** — it's intentionally fire-and-forget (`void work()`).
- **Never add `transfer-encoding` or `connection` to upstream response** — stripped in `buildSafeResponseHeaders`.
- **`@ts-ignore` on `duplex: "half"`** is intentional and required for streaming — do not remove.
- **`quota_limit = 0` means unlimited** (legacy behavior); `quota_limit = -1` is the new unlimited sentinel. Handle both.
- Stats queries use `sql.raw()` with manual `escSql()` — not Drizzle query builder. Do not introduce parameterized queries inconsistently.
## COMMANDS

```bash
bun run dev          # Hot-reload dev server (port 4141)
bun run start        # Production server

bun run db:generate  # Generate Drizzle migration SQL from schema changes
bun run db:migrate   # Apply pending migrations

# Required env vars
ADMIN_TOKEN=<secret>          # Required — throws at startup if missing
PORT=4141                     # Optional
DB_PATH=./data/copilot-router.db  # Optional
GITHUB_CLIENT_ID=...          # Optional (has default)
COPILOT_API_BASE=...          # Optional (has default)
TOKEN_REFRESH_BUFFER=0.8      # JWT refresh before N*expires_at
TEST_MODEL=gpt-5-mini         # Model used for account health tests
```

## NOTES

- **No test suite** — only `playwright-script.js` for manual UI automation/screenshots.
- **Docker**: Multi-platform (amd64/arm64) image built via `.github/workflows/docker.yml` on push to `main` or `v*` tags.
- **Admin UI** at `/admin/` serves static HTML; client-side auth — the HTML shell has no server-side auth guard.
- **`/admin/keys/:id/opencode-config`** endpoint generates ready-to-paste opencode provider config for a given API key.
- **Token cache** is process-scoped (in-memory Map). On restart all tokens are re-fetched — no warm-up needed, just ~1 extra latency on first request per account.

# src/admin/

Admin REST API + static HTML dashboard. All API routes require `Bearer ADMIN_TOKEN`. HTML shell has no server-side auth guard.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add/modify admin API endpoints | `routes.ts` |
| Modify dashboard HTML | `ui/index.html` |

## KEY BEHAVIORS

**Auth**: `adminApp.use('*', ...)` middleware checks `Authorization: Bearer <ADMIN_TOKEN>`. Applied AFTER the HTML route — the `/admin/` HTML shell is publicly served, auth happens client-side in JS.

**`sanitizeAccount()`**: Always wrap account objects in this before JSON response — strips `oauth_token` via destructuring. Located in `routes.ts`.

**opencode-config endpoint** (`GET /admin/keys/:id/opencode-config`):
- Returns pre-formatted JSON snippets for opencode `provider` and `auth` config.
- Uses `Host` header to construct `baseURL` — works behind reverse proxies.

**Stats endpoints** (`/admin/stats`, `/admin/stats/timeseries`, `/admin/requests`):
- All accept `period` param (`today|yesterday|this_week|this_month|last_30_days`) OR explicit `from`/`to` unix timestamps.
- Queries are raw SQL in `src/stats/index.ts` — do not add Drizzle query builder calls there.

## ROUTE SUMMARY

```
GET  /admin/accounts              # List all (sanitized)
POST /admin/accounts/authorize    # Start OAuth device flow
POST /admin/accounts/authorize/poll  # Poll device flow
GET  /admin/accounts/:id          # Get one (sanitized)
PATCH /admin/accounts/:id         # Update name or status
DELETE /admin/accounts/:id        # Delete
POST /admin/accounts/:id/sync     # Sync quota from GitHub
POST /admin/accounts/:id/test     # Health check (real API call)
POST /admin/accounts/sync-all     # Sync all accounts sequentially (1s delay between)

GET  /admin/keys                  # List keys (key shown only on creation)
POST /admin/keys                  # Create key
PATCH /admin/keys/:id             # Set status active/disabled
DELETE /admin/keys/:id            # Delete
GET  /admin/keys/:id/opencode-config  # Generate opencode config snippets

GET  /admin/stats/overview        # Dashboard summary
GET  /admin/stats                 # Grouped stats
GET  /admin/stats/timeseries      # Time-bucketed counts
GET  /admin/requests              # Paginated request log
GET  /admin/health                # Uptime
GET  /admin/pool-status           # Account pool counts by status
```

## ANTI-PATTERNS

- Never return raw account objects — always `sanitizeAccount()`.
- Never add server-side auth to the `/admin/` HTML route — by design, auth is client-side.

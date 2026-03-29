# Learnings — cached-tokens

## [2026-03-29] Session Start

### Codebase Conventions
- Runtime: Bun (not Node). Use `bun:sqlite`, `Bun.file()`, `Bun.serve()`
- tsconfig `noEmit: true` — Bun runs TypeScript directly, no compile step
- Timestamps: Unix epoch seconds (`Math.floor(Date.now() / 1000)`), stored as `integer`
- IDs: `nanoid()` for all primary keys
- DB field names: snake_case in schema/SQL. TypeScript variables: camelCase
- Error returns: `{ success: true, ... } | { success: false, error: string }` union — not throws

### Stats Query Pattern
- ALL stats queries use `sql.raw()` + `escSql()` — NEVER Drizzle query builder
- Aggregation pattern: `SUM(COALESCE(column, 0)) as column`
- Today-filtered pattern: `SUM(CASE WHEN created_at >= ${todayStart} THEN COALESCE(column, 0) ELSE 0 END)`

### Proxy Patterns
- `logRequest()` is ALWAYS fire-and-forget (`void work()`) — NEVER await
- `@ts-ignore` on `duplex: "half"` is intentional — do NOT remove
- `(c as any).set()` for Hono context custom keys

### Frontend Patterns
- Alpine.js + Chart.js: store Chart instances in CLOSURE VARIABLES, NOT Alpine data (causes stack overflow)
- Destroy chart before recreating: `if (chartInstance) { chartInstance.destroy(); }`
- `fillMissingTimePoints()` exists for preventing cliff effects in stacked charts

### Copilot API Cache Fields
- Chat Completions: `usage.prompt_tokens_details.cached_tokens`
- Responses API: `usage.input_tokens_details.cached_tokens`
- Both fields are optional — not all models support prompt caching

### Body Parser Update
- `cachedInputTokens` should follow the same null-safe guard pattern as other token fields: `typeof x === "number" ? x : null`
- Streaming usage extraction must mirror non-streaming endpoint-specific fields for both chat completions and responses events
- Preserve existing usage dispatch behavior; only add the cached token field to the payload

### NULL Semantics
- `NULL` = API didn't return cache info (historical data or unsupported model)
- `0` = confirmed no cache hit
- Aggregations use `COALESCE(cached_input_tokens, 0)`

### Admin Auth
- `/admin/` HTML has NO server-side auth — client-side only
- Admin API uses `ADMIN_TOKEN` — default `test` for dev

### [2026-03-29] Migration Notes
- Drizzle generate added `cached_input_tokens` as a nullable `ALTER TABLE` with no default/index.
- Existing request rows remain `NULL` for the new column after migration.

### [2026-03-29] Proxy Logging Update
- Added `cachedInputTokens` to proxy request logging and mapped it to `cached_input_tokens` in the DB insert.
- Streaming and non-streaming proxy paths now pass cached token counts through to `logRequest()`.
- `bunx tsc --noEmit` still reports unrelated workspace errors outside `src/proxy/`.
- Dev server started successfully on port 4142 during verification.

### [2026-03-29] Stats Queries Update (Task 4)
- Extended 5 existing stats functions with `cached_input_tokens` aggregation:
  - `getOverview()`: `today_cached_input_tokens` via `SUM(CASE WHEN created_at >= todayStart THEN COALESCE(cached_input_tokens, 0) ELSE 0 END)`
  - `getTokenTimeSeries()`: `SUM(COALESCE(cached_input_tokens, 0))` — no table alias needed (single table)
  - `getModelStats()`: `SUM(COALESCE(r.cached_input_tokens, 0))` — uses `r.` prefix
  - `getModelTokenTimeSeries()`: `SUM(COALESCE(cached_input_tokens, 0))` — no alias in existing pattern
  - `getKeyTokenStats()`: `SUM(COALESCE(r.cached_input_tokens, 0))` — uses `r.` prefix (has JOIN)
- New `getCacheRateByModel()` function with `CacheRateByModelParams` accepting same params (from/to/period/api_key_id/model)
- Cache rate SQL: `CASE WHEN SUM(...) = 0 THEN 0.0 ELSE ROUND(CAST(SUM(...) AS REAL) * 100.0 / SUM(...), 2) END`
- `bunx tsc --noEmit`: 0 errors in `src/` (all errors from unrelated `opencode/` workspace)
- sqlite3 verification: all SQL patterns valid, cache_rate returns 0.0 for historical data with NULL cached_input_tokens

### [2026-03-29] Admin Route Exposure (Task 5)
- Added `GET /admin/stats/cache-rate-by-model` in `src/admin/routes.ts` using the same query-param mapping pattern as `/stats/heatmap`.
- Imported both `getCacheRateByModel` and `CacheRateByModelParams` from `../stats`.
- Verified new endpoint returns an array and objects include `cache_rate`, `cached_input_tokens`, `count`, `input_tokens`, and `model`.
- `bunx tsc --noEmit` still fails only because of unrelated `opencode/` workspace errors; `src/admin/routes.ts` itself has no diagnostics.
- Port 4141 was already occupied by an existing Bun process during QA, so the API checks were run against the already-running dev server.

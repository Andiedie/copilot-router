# Learnings — cost-analytics

## 2026-03-29 — Session Init

### Project Conventions (from AGENTS.md + src/db/AGENTS.md)
- Runtime: Bun (not Node). Use `bun:sqlite`, `Bun.file()`, `Bun.serve()`
- tsconfig `noEmit: true` — Bun runs TypeScript directly
- Timestamps: Unix epoch seconds (`Math.floor(Date.now() / 1000)`), stored as `integer`
- IDs: `nanoid()` for all primary keys
- DB field names: snake_case; TypeScript variables: camelCase
- Error returns: `{ success: true, ... } | { success: false, error: string }` — NOT throws
- Stats queries use `sql.raw()` with `escSql()` — NEVER Drizzle query builder
- All timestamps: unix epoch seconds integer
- After schema change: `bun run db:generate && bun run db:migrate`
- Never import sqlite directly — use `db` singleton from `src/db/index.ts`

### Schema Patterns (from src/db/schema.ts)
- Tables defined with `sqliteTable("name", { ... }, (t) => [index(...).on(t.field)])` pattern
- PKs: `text("id").primaryKey()`
- Required fields: `.notNull()`
- Optional fields: no `.notNull()` (nullable)
- Timestamps: `integer("created_at").notNull()`

### Stats Module Patterns (src/stats/index.ts)
- All stats functions use `resolveTimeRange()`, `buildWhereClause()`, `escSql()`
- Raw SQL via `sql.raw()` — no Drizzle query builder
- `escSql()` at lines 139-141 — MUST use for string interpolation
- `buildWhereClause()` at lines 125-137 — MUST use for WHERE clauses
- `resolveTimeRange()` + `periodToRange()` at lines 86-112
- `intervalFmt()` at lines 114-123 — for time bucketing
- `getOverview()` at lines 143-207 — template for cost overview
- `getTokenTimeSeries()` at lines 296-322 — template for time-series
- `getModelStats()` at lines 341-376 — template for per-model grouping
- `getKeyTokenStats()` at lines 515-540 — template for per-key grouping
- `getCacheRateByModel()` at lines 602-636 — last function, append after this

## 2026-03-29 — Model Pricing Schema

- Added `model_pricing` after `requests` using the existing `sqliteTable(..., (t) => [...])` pattern.
- `copilot_model_name` is unique and indexed; generated migration also creates the implicit unique index.
- Verification used `bun run db:generate && bun run db:migrate`, dev server health check, and `sqlite3 .schema model_pricing`.

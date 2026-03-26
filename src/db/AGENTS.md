# src/db/

Drizzle ORM singleton + SQLite schema + migration runner. Three files, rarely touched directly.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add/modify tables or columns | `schema.ts` → then `bun run db:generate && bun run db:migrate` |
| DB connection / PRAGMA config | `index.ts` |
| Run migrations programmatically | `migrate.ts` |

## SCHEMA SUMMARY

| Table | Key columns | Notes |
|-------|------------|-------|
| `accounts` | `id`, `oauth_token`, `status`, `quota_limit`, `quota_used` | `quota_limit=0` legacy unlimited; `-1` new unlimited |
| `api_keys` | `id`, `key`, `key_hash`, `key_prefix`, `status` | `key` only returned at creation |
| `requests` | `api_key_id`, `account_id`, `model`, `status_code`, `duration_ms` | Indexed on `api_key_id`, `account_id`, `model`, `created_at`, `status_code` |

## CONVENTIONS

- All timestamps: unix epoch seconds (`integer`).
- All PKs: `nanoid()` strings.
- DB field names: snake_case. TS variables: camelCase.
- WAL mode + NORMAL sync set at startup in `index.ts`.

## ANTI-PATTERNS

- Never import `sqlite` directly — use the exported `db` singleton from `index.ts`.
- Stats queries (`src/stats/index.ts`) use `sql.raw()` + `escSql()` — do not mix in Drizzle query builder calls.
- After any schema change, **must** run `db:generate` then `db:migrate` — do not edit migration SQL manually.

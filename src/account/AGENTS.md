# src/account/

Account lifecycle management: CRUD, OAuth device flow, JWT token cache, and pool selection.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add account / OAuth flow | `oauth.ts` — `startDeviceFlow()` + `pollDeviceFlow()` |
| Token refresh logic | `token.ts` — `getToken()`, `doRefresh()` |
| Pool/selection algorithm | `pool.ts` — `selectAccount()` |
| Account DB operations | `index.ts` — all CRUD functions |

## KEY BEHAVIORS

**Token cache** (`token.ts`):
- In-memory `Map<account_id, CachedToken>` — process-scoped, cleared on restart.
- In-flight dedup via second `Map<account_id, Promise>` — parallel requests share one refresh.
- Refresh triggered when `now >= expiresAt * TOKEN_REFRESH_BUFFER` (default 0.8).
- On exchange failure: sets account status to `'error'`, deletes cache entry, returns `null`.

**Pool selection** (`pool.ts`):
- Fetches all `status='active'` accounts each call (no in-memory cache).
- `quota_limit = 0` treated as `9999` (unlimited legacy sentinel); `quota_limit = -1` is new unlimited.
- Candidates = accounts within 80% of best remaining quota.
- Round-robin counter (`rrCounter`) is module-level, resets on restart.

**OAuth device flow** (`oauth.ts`):
- Scope requested: `read:user` only (Copilot access comes from the token itself).
- Auto-fetches `github_login` from `/user` after token grant.
- Returns `{ status: 'pending' | 'slow_down' | 'expired' | 'error' | 'success' }`.

## ANTI-PATTERNS

- Never read `oauth_token` from an account object for display — pass through `sanitizeAccount()` (defined in `src/admin/routes.ts`).
- Never call `refreshToken()` unless force-invalidating; normal path is `getToken()`.
- `rrCounter` is not persisted — do not assume round-robin survives restarts.

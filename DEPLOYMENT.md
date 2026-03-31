# Deployment Notes

## Cloudflare HTTP 524 Timeout

**Diagnosed:** 2026-03-31 using `__test_model__` debug model.

### Problem

Non-streaming requests that take >100s before the first response byte are terminated by Cloudflare with **HTTP 524** (origin timeout). This affects long-running LLM completions when the upstream Copilot API is slow to respond.

Streaming requests are **not affected** as long as data flows at least once per ~100 seconds.

### Evidence

Tested via `__test_model__` through `copilot-router.ssoo.fun` (Cloudflare proxied):

| Test | Result |
|------|--------|
| Non-streaming, 300s total | **HTTP 524** — Cloudflare killed at ~125s. Bun logged `Client disconnected after 125.1s`. |
| Non-streaming, 30s total | **200 OK** — completed normally. |
| Streaming, 300s total, 10s interval | **200 OK** — all 30 chunks delivered over 5 minutes. |
| Streaming, 300s total, 30s interval | **200 OK** — all 10 chunks delivered over 5 minutes. |

Bun server remained healthy throughout all tests — the disconnect originates from Cloudflare, not Bun or the reverse proxy.

### Root Cause

Cloudflare Free/Pro/Business plans enforce a **100-second timeout** for the origin to send the first byte of the HTTP response. This is not configurable on these plans. See [Cloudflare docs: Error 524](https://developers.cloudflare.com/support/troubleshooting/cloudflare-errors/troubleshooting-cloudflare-5xx-errors/#error-524-a-timeout-occurred).

Streaming responses bypass this limit because the `200` status + headers + first SSE chunk are sent immediately (within milliseconds), and subsequent chunks keep the connection alive.

### Mitigation Options

1. **Cloudflare Enterprise** — allows custom `proxy_read_timeout` (not available on Free/Pro/Business).
2. **Cloudflare Tunnel (`cloudflared`)** — higher timeout limits than DNS proxy mode.
3. **DNS-only (gray cloud) for API subdomain** — bypass Cloudflare proxy for the API endpoint, let clients connect directly to the origin (via openresty). Use Cloudflare proxy only for the admin UI or other non-API traffic.
4. **Accept the limitation** — in practice, most Copilot streaming requests complete well within 100s for the first chunk. Non-streaming requests rarely take >100s. Monitor for 524 errors and investigate only if they become frequent.

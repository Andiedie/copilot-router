# src/proxy/

Core request forwarding to `api.githubcopilot.com`. Three files: handler, header builder, fire-and-forget logger.

## WHERE TO LOOK

| Task | File |
|------|------|
| Modify forwarding logic | `index.ts` — `proxyHandler()` |
| Add/remove passthrough headers | `headers.ts` — `PASSTHROUGH_HEADERS` array |
| Change Copilot identity headers | `headers.ts` — `COPILOT_HEADERS` const |
| Request logging | `logger.ts` — `logRequest()` |

## KEY BEHAVIORS

**Path forwarding** (`index.ts`):
- Path is forwarded as-is (no prefix stripping): `/v1/chat/completions` stays `/v1/chat/completions` upstream.
- Both `/v1/*` and `/*` routes map to `proxyHandler`.

**Header policy** (`headers.ts`):
- `COPILOT_HEADERS` always injected: `User-Agent`, `Editor-Version`, `Editor-Plugin-Version`, `Copilot-Integration-Id`.
- Only headers in `PASSTHROUGH_HEADERS` are forwarded from client: `content-type`, `accept`, `openai-intent`, `x-initiator`, `copilot-vision-request`, `x-request-id`.
- All other client headers are silently dropped.
- Response: `transfer-encoding` and `connection` stripped via `buildSafeResponseHeaders`.

**Model extraction**: Regex on raw request body — `/"model"\s*:\s*"([^"]+)"/`. Falls back to `"unknown"`.

**Logging** (`logger.ts`):
- `logRequest()` returns `void` — fire-and-forget. Never `await` it.
- Records: `api_key_id`, `account_id`, `model`, `endpoint`, `status_code`, `duration_ms`, `error`.
- Only logs if `apiKey` is set in context (unauthenticated requests skip logging).

## ANTI-PATTERNS

- Do not add `transfer-encoding` or `connection` to upstream response — breaks streaming.
- `@ts-ignore` on `duplex: "half"` is required for streaming request bodies — do not remove.
- Never `await logRequest()` — intentionally non-blocking.

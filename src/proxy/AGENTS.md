# src/proxy/

Core request forwarding to `api.githubcopilot.com`. Handler, header builder, fire-and-forget logger, and debug test model.

## WHERE TO LOOK

| Task | File |
|------|------|
| Modify forwarding logic | `index.ts` — `proxyHandler()` |
| Test model (debug connection timeouts) | `test-model.ts` — `handleTestModel()` |
| Add/remove passthrough headers | `headers.ts` — `PASSTHROUGH_HEADERS` array |
| Change Copilot identity headers | `headers.ts` — `COPILOT_HEADERS` const |
| Request/response body parsing | `body-parser.ts` |
| Request logging | `logger.ts` — `logRequest()` |

## KEY BEHAVIORS

**Path forwarding** (`index.ts`):
- Body is read and model extracted BEFORE account selection — enables test model intercept without needing a valid account/JWT.
- Path is forwarded as-is (no prefix stripping): `/v1/chat/completions` stays `/v1/chat/completions` upstream.
- Both `/v1/*` and `/*` routes map to `proxyHandler`.

**Header policy** (`headers.ts`):
- `COPILOT_HEADERS` always injected: `User-Agent`, `Editor-Version`, `Editor-Plugin-Version`, `Copilot-Integration-Id`.
- Only headers in `PASSTHROUGH_HEADERS` are forwarded from client: `content-type`, `accept`, `openai-intent`, `x-initiator`, `copilot-vision-request`, `x-request-id`.
- All other client headers are silently dropped.
- Response: `transfer-encoding` and `connection` stripped via `buildSafeResponseHeaders`.

**Body Parsing** (`body-parser.ts`):
- `extractModelFromBody(body)` — regex extraction from raw JSON text; returns `null` when no model is present or parsing fails.
- `detectEndpoint(path)` / `isStreamableEndpoint(path)` — endpoint classification uses the raw path as-is; streamable endpoints include `/chat/completions` and `/responses`.
- `extractRequestInfo(req, path)` — clones the request and reads body text asynchronously inside `try/catch`; returns `{ model, endpoint }` without throwing.
- `injectStreamUsageOption(bodyText)` — the only allowed request body mutation; adds `stream_options.include_usage=true` only for streamed requests that do not already have it.
- `extractUsageFromResponse(response, endpoint)` — reads non-stream 2xx responses from a cloned response and extracts usage/model when present.
- `createStreamTap(endpoint, onUsage)` — byte-for-byte `TransformStream<Uint8Array, Uint8Array>` passthrough that taps SSE lines for usage while preserving chunks unchanged.

**Logging** (`logger.ts`):
- `logRequest()` returns `void` — fire-and-forget. Never `await` it.
- Records: `api_key_id`, `account_id`, `model`, `endpoint`, `input_tokens`, `output_tokens`, `status_code`, `duration_ms`, `error`.
- Only logs if `apiKey` is set in context (unauthenticated requests skip logging).

## ANTI-PATTERNS

- Do not add `transfer-encoding` or `connection` to upstream response — breaks streaming.
- `@ts-ignore` on `duplex: "half"` is required for streaming request bodies — do not remove.
- Never `await logRequest()` — intentionally non-blocking.

**Test Model** (`test-model.ts`):
- `isTestModel(model)` — regex match for `__test_model__[duration[_interval]__]`.
- `parseTestModelConfig(model)` — extracts `durationSec` (default 300) and `intervalSec` (default 10) from model name.
- `handleTestModel(c, model, isStream)` — returns mock OpenAI responses. Non-streaming sleeps then returns JSON; streaming sends SSE chunks at intervals via `ReadableStream`.
- Logs every lifecycle event to console with `[test-model]` prefix: start, each chunk, client disconnect, completion.
- Detects client abort via `c.req.raw.signal` — logged as disconnect.
- Does NOT write to DB via `logRequest()` — console-only for real-time debugging.

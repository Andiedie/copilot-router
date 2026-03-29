import type { Context } from "hono"
import { setAccountStatus } from "../account"
import { selectAccount } from "../account/pool"
import { clearTokenCache, getToken } from "../account/token"
import { config } from "../config"
import {
  createStreamTap,
  extractModelFromBody,
  extractUsageFromResponse,
  injectStreamUsageOption,
  isStreamableEndpoint,
} from "./body-parser"
import { buildUpstreamHeaders } from "./headers"
import { logRequest } from "./logger"

export async function proxyHandler(c: Context) {
  const startTime = performance.now()

  if (c.req.path.startsWith("/admin")) {
    return c.notFound()
  }

  const apiKey = (c as any).get("apiKey") as { id: string } | undefined
  const originalUrl = new URL(c.req.url)

  const account = await selectAccount(apiKey?.id)
  if (!account) {
    const durationMs = Math.round(performance.now() - startTime)
    if (apiKey) {
      logRequest({
        apiKeyId: apiKey.id,
        accountId: null,
        statusCode: 503,
        durationMs,
        error: "No available accounts",
      })
    }
    return c.json({ error: "No available accounts" }, 503)
  }

  const jwt = await getToken(account.id)
  if (!jwt) {
    const durationMs = Math.round(performance.now() - startTime)
    if (apiKey) {
      logRequest({
        apiKeyId: apiKey.id,
        accountId: account.id,
        statusCode: 502,
        durationMs,
        error: "Failed to get token for account",
      })
    }
    return c.json({ error: "Failed to get token for account" }, 502)
  }

  let bodyText: string | null = null
  try {
    bodyText = await c.req.raw.clone().text()
  } catch {
  }

  const endpoint = originalUrl.pathname
  const requestModel = bodyText ? extractModelFromBody(bodyText) : null

  let requestBody: string | null = null
  if (bodyText && isStreamableEndpoint(endpoint)) {
    const injected = injectStreamUsageOption(bodyText)
    if (injected !== null) {
      requestBody = injected
    }
  }
  const fetchBody: string | ReadableStream | null = requestBody ?? bodyText ?? c.req.raw.body

  const upstreamUrl = `${config.copilotApiBase}${originalUrl.pathname}${originalUrl.search}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, jwt)

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: fetchBody,
      // @ts-ignore duplex is required by some runtimes for streamed request body
      duplex: "half",
    })
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime)
    if (apiKey) {
      logRequest({
        apiKeyId: apiKey.id,
        accountId: account.id,
        statusCode: 502,
        durationMs,
        error: String(err),
      })
    }
    return c.json({ error: "Upstream request failed", detail: String(err) }, 502)
  }

  const durationMs = Math.round(performance.now() - startTime)

  if (upstreamRes.status === 429 && upstreamRes.headers.get("x-ratelimit-exceeded") === "quota_exceeded") {
    void (async () => {
      await setAccountStatus(account.id, "disabled")
      clearTokenCache(account.id)
      console.warn(`[proxy] Account ${account.github_login ?? account.id} quota exhausted — auto-disabled`)
    })()
  }

  ;(c as any).set("proxyAccount", account)
  ;(c as any).set("proxyStatus", upstreamRes.status)

  const isStream = upstreamRes.headers.get("content-type")?.includes("text/event-stream") ?? false

  if (isStream) {
    let usageLogged = false
    const tap = createStreamTap(endpoint, (usage) => {
      if (apiKey && !usageLogged) {
        usageLogged = true
        const totalDurationMs = Math.round(performance.now() - startTime)
        logRequest({
          apiKeyId: apiKey.id,
          accountId: account.id,
          model: usage.model ?? requestModel,
          endpoint,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          statusCode: upstreamRes.status,
          durationMs: totalDurationMs,
        })
      }
    })
    const tappedBody = upstreamRes.body?.pipeThrough(tap) ?? null
    return new Response(tappedBody, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    })
  } else {
    const usageInfo = await extractUsageFromResponse(upstreamRes, endpoint)
    if (apiKey) {
      logRequest({
        apiKeyId: apiKey.id,
        accountId: account.id,
        model: usageInfo?.model ?? requestModel,
        endpoint,
        inputTokens: usageInfo?.inputTokens ?? null,
        outputTokens: usageInfo?.outputTokens ?? null,
        cachedInputTokens: usageInfo?.cachedInputTokens ?? null,
        statusCode: upstreamRes.status,
        durationMs,
      })
    }
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    })
  }
}

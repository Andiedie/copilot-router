import type { Context } from "hono"
import { selectAccount } from "../account/pool"
import { getToken } from "../account/token"
import { config } from "../config"
import { buildUpstreamHeaders } from "./headers"
import { logRequest } from "./logger"

function buildSafeResponseHeaders(upstreamHeaders: Headers): Headers {
  const responseHeaders = new Headers()
  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase()
    if (lower === "transfer-encoding" || lower === "connection") {
      continue
    }
    responseHeaders.set(key, value)
  }
  return responseHeaders
}

export async function proxyHandler(c: Context) {
  const startTime = performance.now()

  if (c.req.path.startsWith("/admin")) {
    return c.notFound()
  }

  const apiKey = (c as any).get("apiKey") as { id: string } | undefined
  const originalUrl = new URL(c.req.url)
  const upstreamPath = originalUrl.pathname.startsWith("/v1")
    ? originalUrl.pathname.slice(3)
    : originalUrl.pathname

  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD"
  const bodyText = hasBody ? await c.req.text() : ""
  const model = /"model"\s*:\s*"([^"]+)"/.exec(bodyText)?.[1] ?? "unknown"

  const account = await selectAccount()
  if (!account) {
    const durationMs = Math.round(performance.now() - startTime)
    if (apiKey) {
      logRequest({
        apiKeyId: apiKey.id,
        accountId: null,
        model,
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
        model,
        statusCode: 502,
        durationMs,
        error: "Failed to get token for account",
      })
    }
    return c.json({ error: "Failed to get token for account" }, 502)
  }

  const upstreamUrl = `${config.copilotApiBase}${upstreamPath}${originalUrl.search}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, jwt)

  const upstreamRes = await fetch(upstreamUrl, {
    method: c.req.method,
    headers,
    body: hasBody ? bodyText : undefined,
    // @ts-ignore duplex is required by some runtimes for streamed request body
    duplex: "half",
  })

  const durationMs = Math.round(performance.now() - startTime)

  ;(c as any).set("proxyAccount", account)
  ;(c as any).set("proxyStatus", upstreamRes.status)

  if (apiKey) {
    logRequest({
      apiKeyId: apiKey.id,
      accountId: account.id,
      model,
      statusCode: upstreamRes.status,
      durationMs,
    })
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: buildSafeResponseHeaders(upstreamRes.headers),
  })
}

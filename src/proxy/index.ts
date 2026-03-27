import type { Context } from "hono"
import { selectAccount } from "../account/pool"
import { getToken } from "../account/token"
import { config } from "../config"
import { buildUpstreamHeaders } from "./headers"
import { logRequest } from "./logger"

export async function proxyHandler(c: Context) {
  const startTime = performance.now()

  if (c.req.path.startsWith("/admin")) {
    return c.notFound()
  }

  const apiKey = (c as any).get("apiKey") as { id: string } | undefined
  const originalUrl = new URL(c.req.url)

  const account = await selectAccount()
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

  const upstreamUrl = `${config.copilotApiBase}${originalUrl.pathname}${originalUrl.search}`
  const headers = buildUpstreamHeaders(c.req.raw.headers, jwt)

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: c.req.raw.body,
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

  ;(c as any).set("proxyAccount", account)
  ;(c as any).set("proxyStatus", upstreamRes.status)

  if (apiKey) {
    logRequest({
      apiKeyId: apiKey.id,
      accountId: account.id,
      statusCode: upstreamRes.status,
      durationMs,
    })
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  })
}

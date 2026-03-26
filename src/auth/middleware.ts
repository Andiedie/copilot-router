import type { Context, Next } from "hono"
import { validateApiKey } from "./index"

export async function bearerAuth(c: Context, next: Next) {
  if (c.req.path.startsWith("/admin")) {
    return next()
  }

  const auth = c.req.header("Authorization")
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Invalid or revoked API key" }, 401)
  }

  const key = auth.slice(7)
  const record = await validateApiKey(key)
  if (!record) {
    return c.json({ error: "Invalid or revoked API key" }, 401)
  }

  ;(c as any).set("apiKey", record)
  return next()
}

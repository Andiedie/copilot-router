import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db"
import { api_keys } from "../db/schema"

export async function createApiKey(name: string) {
  const id = nanoid()
  const key = `sk-cr-${nanoid(32)}`
  const now = Math.floor(Date.now() / 1000)

  await db.insert(api_keys).values({
    id,
    key,
    name,
    status: "active",
    created_at: now,
    total_requests: 0,
  })

  return { id, key }
}

export async function listApiKeys() {
  const keys = await db
    .select({
      id: api_keys.id,
      key: api_keys.key,
      name: api_keys.name,
      status: api_keys.status,
      account_id: api_keys.account_id,
      created_at: api_keys.created_at,
      last_used_at: api_keys.last_used_at,
      total_requests: api_keys.total_requests,
    })
    .from(api_keys)

  return keys
}

export async function setApiKeyStatus(id: string, status: "active" | "disabled") {
  await db.update(api_keys).set({ status }).where(eq(api_keys.id, id))
}

export async function deleteApiKey(id: string) {
  await db.delete(api_keys).where(eq(api_keys.id, id))
}

export async function clearApiKeyBinding(id: string) {
  await db.update(api_keys).set({ account_id: null }).where(eq(api_keys.id, id))
}

export async function validateApiKey(key: string) {
  const [record] = await db.select().from(api_keys).where(eq(api_keys.key, key))
  if (!record || record.status !== "active") return null

  const now = Math.floor(Date.now() / 1000)
  await db
    .update(api_keys)
    .set({
      last_used_at: now,
      total_requests: record.total_requests + 1,
    })
    .where(eq(api_keys.id, record.id))

  return record
}

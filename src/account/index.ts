import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db'
import { accounts, api_keys } from '../db/schema'

type AccountStatus = 'active' | 'disabled' | 'error'

export async function createAccount(data: {
  name: string
  oauth_token: string
  github_login?: string
}) {
  const id = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await db.insert(accounts).values({
    id,
    name: data.name,
    oauth_token: data.oauth_token,
    github_login: data.github_login ?? null,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return getAccount(id)
}

export async function listAccounts() {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      github_login: accounts.github_login,
      status: accounts.status,
      quota_limit: accounts.quota_limit,
      quota_used: accounts.quota_used,
      last_used_at: accounts.last_used_at,
      created_at: accounts.created_at,
      updated_at: accounts.updated_at,
    })
    .from(accounts)
  return rows
}

export async function getAccount(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id))
  return row ?? null
}

export async function getActiveAccounts() {
  return db.select().from(accounts).where(eq(accounts.status, 'active'))
}

export async function updateAccount(
  id: string,
  updates: Partial<{
    name: string
  }>,
) {
  const now = Math.floor(Date.now() / 1000)
  await db.update(accounts).set({ ...updates, updated_at: now }).where(eq(accounts.id, id))
  return getAccount(id)
}

export async function setAccountStatus(id: string, status: AccountStatus) {
  const now = Math.floor(Date.now() / 1000)
  await db
    .update(accounts)
    .set({
      status,
      updated_at: now,
    })
    .where(eq(accounts.id, id))

  // Clear API key affinity bindings when account is no longer active
  if (status !== 'active') {
    await db.update(api_keys).set({ account_id: null }).where(eq(api_keys.account_id, id))
  }
}

export async function deleteAccount(id: string) {
  // Clear API key affinity bindings before deleting
  await db.update(api_keys).set({ account_id: null }).where(eq(api_keys.account_id, id))
  await db.delete(accounts).where(eq(accounts.id, id))
}

export async function updateAccountQuota(
  id: string,
  data: {
    quota_limit: number
    quota_used: number
  },
) {
  const now = Math.floor(Date.now() / 1000)
  await db
    .update(accounts)
    .set({
      quota_limit: data.quota_limit,
      quota_used: data.quota_used,
      updated_at: now,
    })
    .where(eq(accounts.id, id))
}

export async function updateAccountLastUsed(id: string) {
  const now = Math.floor(Date.now() / 1000)
  await db.update(accounts).set({ last_used_at: now, updated_at: now }).where(eq(accounts.id, id))
}

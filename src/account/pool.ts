import { eq, sql } from 'drizzle-orm'
import { getActiveAccounts, getAccount } from './index'
import { db } from '../db'
import { api_keys } from '../db/schema'

let rrCounter = 0

export async function selectAccount(apiKeyId?: string) {
  if (apiKeyId) {
    const [keyRow] = await db
      .select({ account_id: api_keys.account_id })
      .from(api_keys)
      .where(eq(api_keys.id, apiKeyId))

    if (keyRow?.account_id) {
      const account = await getAccount(keyRow.account_id)
      if (account && account.status === 'active') {
        return account
      }
      // Stale binding (account disabled/error/deleted) — clear it, fall through to normal selection
      await db.update(api_keys).set({ account_id: null }).where(eq(api_keys.id, apiKeyId))
    }
  }

  const active = await getActiveAccounts()
  if (active.length === 0) return null

  let selected = active[rrCounter % active.length]
  rrCounter++

  if (apiKeyId && active.length > 1) {
    const bindingCounts = await db
      .select({
        account_id: api_keys.account_id,
        count: sql<number>`count(*)`,
      })
      .from(api_keys)
      .where(sql`${api_keys.account_id} is not null`)
      .groupBy(api_keys.account_id)

    const countMap = new Map<string, number>()
    for (const row of bindingCounts) {
      if (row.account_id) countMap.set(row.account_id, row.count)
    }

    selected = [...active].sort((a, b) => (countMap.get(a.id) ?? 0) - (countMap.get(b.id) ?? 0))[0]
  }

  if (apiKeyId && selected) {
    await db.update(api_keys).set({ account_id: selected.id }).where(eq(api_keys.id, apiKeyId))
  }

  return selected
}

export async function getPoolStatus() {
  const { db } = await import('../db')
  const { accounts } = await import('../db/schema')
  const all = await db.select({
    status: accounts.status,
  }).from(accounts)

  return {
    total: all.length,
    active: all.filter(a => a.status === 'active').length,
    disabled: all.filter(a => a.status === 'disabled').length,
    error: all.filter(a => a.status === 'error').length,
  }
}

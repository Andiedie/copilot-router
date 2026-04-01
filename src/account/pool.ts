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
        const isUnlimited = account.quota_limit === 0 || account.quota_limit === -1
        const hasQuota = isUnlimited || (account.quota_limit - account.quota_used) > 0
        if (hasQuota) {
          return account
        }
      }
      // Stale binding — clear it, fall through to normal selection
      await db.update(api_keys).set({ account_id: null }).where(eq(api_keys.id, apiKeyId))
    }
  }

  const active = await getActiveAccounts()
  if (active.length === 0) return null

  // quota_limit=0 means unlimited (treated as 9999); sort descending by remaining
  const sorted = [...active].sort((a, b) => {
    const remA = a.quota_limit > 0 ? (a.quota_limit - a.quota_used) : 9999
    const remB = b.quota_limit > 0 ? (b.quota_limit - b.quota_used) : 9999
    return remB - remA
  })

  // Candidates within 80% of best remaining quota get round-robin selection
  const best = sorted[0].quota_limit > 0 ? (sorted[0].quota_limit - sorted[0].quota_used) : 9999
  const threshold = best * 0.8
  const candidates = sorted.filter(a => {
    const rem = a.quota_limit > 0 ? (a.quota_limit - a.quota_used) : 9999
    return rem >= threshold
  })

  let selected = candidates[rrCounter % candidates.length]
  rrCounter++

  // When binding a new key, prefer the account with the fewest existing bindings (spread strategy)
  if (apiKeyId && candidates.length > 1) {
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

    // Sort candidates by binding count ascending — pick the least-bound account
    const spreadSorted = [...candidates].sort((a, b) => {
      return (countMap.get(a.id) ?? 0) - (countMap.get(b.id) ?? 0)
    })
    selected = spreadSorted[0]
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

import { getActiveAccounts } from './index'

let rrCounter = 0

export async function selectAccount() {
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

  const selected = candidates[rrCounter % candidates.length]
  rrCounter++
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

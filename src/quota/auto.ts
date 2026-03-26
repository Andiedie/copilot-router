import { eq } from 'drizzle-orm'
import { getAccount, setAccountStatus, updateAccountQuota } from '../account'
import { config } from '../config'
import { db } from '../db'
import { accounts } from '../db/schema'

export async function checkAndAutoDisable(
  account_id: string,
): Promise<{ disabled: boolean; remaining: number }> {
  const account = await getAccount(account_id)
  if (!account) {
    return { disabled: false, remaining: 0 }
  }

  const remaining = account.quota_limit - account.quota_used
  if (account.quota_limit <= 0) {
    return { disabled: false, remaining }
  }

  const threshold = account.auto_disable_threshold ?? config.autoDisableThreshold
  if (remaining <= threshold && account.status === 'active') {
    await setAccountStatus(account_id, 'exhausted')
    return { disabled: true, remaining }
  }

  return { disabled: false, remaining }
}

export async function checkQuotaReset(): Promise<{ reactivated: number }> {
  const now = Math.floor(Date.now() / 1000)
  const exhaustedAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.status, 'exhausted'))

  let reactivated = 0
  for (const account of exhaustedAccounts) {
    if (account.quota_reset_at === null || account.quota_reset_at > now) {
      continue
    }

    await updateAccountQuota(account.id, {
      quota_limit: account.quota_limit,
      quota_used: 0,
      quota_reset_at: null,
    })
    await setAccountStatus(account.id, 'active')
    reactivated++
  }

  return { reactivated }
}

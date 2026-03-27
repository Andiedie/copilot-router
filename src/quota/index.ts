import { config } from '../config'
import { db } from '../db'
import { getAccount, getActiveAccounts, updateAccountQuota } from '../account'
import { getToken } from '../account/token'
import { COPILOT_HEADERS } from '../proxy/headers'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function syncAccountQuota(
  account_id: string,
): Promise<
  | { success: true; quota_limit: number; quota_used: number; remaining: number }
  | { success: false; error: string }
> {
  const account = await getAccount(account_id)
  if (!account) {
    return { success: false, error: `Account not found: ${account_id}` }
  }
  if (!account.oauth_token) {
    return { success: false, error: `Account has no oauth_token: ${account_id}` }
  }

  try {
    const res = await fetch(`${config.githubApiBase}/copilot_internal/user`, {
      headers: {
        'Authorization': `token ${account.oauth_token}`,
        'User-Agent': 'GitHubCopilotChat/0.26.7',
        'Editor-Version': 'vscode/1.99.3',
        'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      },
    })

    if (!res.ok) {
      return { success: false, error: `GitHub API error: ${res.status}` }
    }

    const data = (await res.json()) as any
    const premium = data?.quota_snapshots?.premium_interactions
    if (!premium) {
      return { success: false, error: 'No premium_interactions in response' }
    }

    const { entitlement, remaining, unlimited } = premium
    const quota_limit = unlimited === true ? -1 : (entitlement as number)
    const quota_used = unlimited === true ? 0 : Math.max(0, (entitlement as number) - (remaining as number))

    await updateAccountQuota(account_id, {
      quota_limit,
      quota_used,
    })

    return { success: true, quota_limit, quota_used, remaining: remaining as number }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) }
  }
}

export async function syncAllQuotas(): Promise<{ synced: number; failed: number }> {
  const activeAccounts = await getActiveAccounts()
  let synced = 0
  let failed = 0

  for (const account of activeAccounts) {
    const result = await syncAccountQuota(account.id)
    if (result.success) {
      synced++
    } else {
      failed++
    }
    await sleep(1000)
  }

  return { synced, failed }
}

export async function testAccount(
  account_id: string,
): Promise<
  | { success: true; latency_ms: number; model: string }
  | { success: false; latency_ms: number; model: string; error: string }
> {
  const model = config.testModel
  const start = performance.now()

  try {
    const jwt = await getToken(account_id)
    if (!jwt) {
      const latency_ms = Math.round(performance.now() - start)
      return { success: false, latency_ms, model, error: 'Failed to obtain JWT token' }
    }

    const res = await fetch(`${config.copilotApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        ...COPILOT_HEADERS,
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })

    const latency_ms = Math.round(performance.now() - start)

    if (res.ok) {
      return { success: true, latency_ms, model }
    }

    const errorBody = await res.text().catch(() => '')
    return {
      success: false,
      latency_ms,
      model,
      error: `API returned ${res.status}: ${errorBody}`.slice(0, 500),
    }
  } catch (err: any) {
    const latency_ms = Math.round(performance.now() - start)
    return { success: false, latency_ms, model, error: err.message ?? String(err) }
  }
}

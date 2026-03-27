import { config } from '../config'
import { getAccount, setAccountStatus } from './index'

interface CachedToken {
  token: string
  expiresAt: number // unix timestamp (seconds)
}

// In-memory JWT cache: account_id → cached token
const tokenCache = new Map<string, CachedToken>()

// In-flight refresh dedup: account_id → Promise<string | null>
const inflightRefresh = new Map<string, Promise<string | null>>()

export async function exchangeToken(oauth_token: string): Promise<{
  token: string
  expires_at: number
  refresh_in: number
}> {
  const res = await fetch(`${config.githubApiBase}/copilot_internal/v2/token`, {
    headers: {
      'Authorization': `token ${oauth_token}`,
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'Editor-Version': 'vscode/1.99.3',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    },
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}`)
  }
  const data = (await res.json()) as any
  return {
    token: data.token,
    expires_at: data.expires_at,
    refresh_in: data.refresh_in ?? Math.floor((data.expires_at - Date.now() / 1000) * 0.8),
  }
}

async function doRefresh(account_id: string): Promise<string | null> {
  const account = await getAccount(account_id)
  if (!account || !account.oauth_token) return null
  try {
    const result = await exchangeToken(account.oauth_token)
    tokenCache.set(account_id, {
      token: result.token,
      expiresAt: result.expires_at,
    })
    return result.token
  } catch {
    await setAccountStatus(account_id, 'error')
    tokenCache.delete(account_id)
    return null
  } finally {
    inflightRefresh.delete(account_id)
  }
}

export async function getToken(account_id: string): Promise<string | null> {
  const cached = tokenCache.get(account_id)
  const now = Date.now() / 1000

  if (cached && now < cached.expiresAt * config.tokenRefreshBuffer) {
    return cached.token
  }

  const inflight = inflightRefresh.get(account_id)
  if (inflight) return inflight

  const refreshPromise = doRefresh(account_id)
  inflightRefresh.set(account_id, refreshPromise)
  return refreshPromise
}

export async function refreshToken(account_id: string): Promise<string | null> {
  tokenCache.delete(account_id)
  inflightRefresh.delete(account_id)
  const refreshPromise = doRefresh(account_id)
  inflightRefresh.set(account_id, refreshPromise)
  return refreshPromise
}

export function clearTokenCache(account_id?: string) {
  if (account_id) {
    tokenCache.delete(account_id)
    inflightRefresh.delete(account_id)
  } else {
    tokenCache.clear()
    inflightRefresh.clear()
  }
}

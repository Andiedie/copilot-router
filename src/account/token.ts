import { config } from '../config'
import { getAccount, setAccountStatus } from './index'
import { COPILOT_IDENTITY_HEADERS } from '../proxy/headers'

interface CachedToken {
  token: string
  refreshAfter: number // unix timestamp (seconds) — refresh once past this point
}

// In-memory JWT cache: account_id → cached token
const tokenCache = new Map<string, CachedToken>()

// In-flight refresh dedup: account_id → Promise<string | null>
const inflightRefresh = new Map<string, Promise<string | null>>()

class TokenExchangeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export async function exchangeToken(oauth_token: string): Promise<{
  token: string
  expires_at: number
  refresh_in: number
}> {
  const res = await fetch(`${config.githubApiBase}/copilot_internal/v2/token`, {
    headers: {
      ...COPILOT_IDENTITY_HEADERS,
      'authorization': `token ${oauth_token}`,
    },
  })
  if (!res.ok) {
    throw new TokenExchangeError(res.status, `Token exchange failed: ${res.status}`)
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
    const now = Date.now() / 1000
    tokenCache.set(account_id, {
      token: result.token,
      refreshAfter: now + result.refresh_in,
    })
    return result.token
  } catch (err) {
    const label = account.github_login ?? account_id
    if (err instanceof TokenExchangeError) {
      if (err.status === 401) {
        await setAccountStatus(account_id, 'error')
        console.warn(`[token] Account ${label} OAuth token invalid (HTTP ${err.status}) — marked as error`)
      } else {
        console.warn(`[token] Account ${label} token exchange failed (HTTP ${err.status})`)
      }
    } else {
      console.warn(`[token] Account ${label} token exchange failed:`, err)
    }
    tokenCache.delete(account_id)
    return null
  } finally {
    inflightRefresh.delete(account_id)
  }
}

export async function getToken(account_id: string): Promise<string | null> {
  const cached = tokenCache.get(account_id)
  const now = Date.now() / 1000

  if (cached && now < cached.refreshAfter) {
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

import { createAccount } from './index'
import { config } from '../config'

interface DeviceFlowResult {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
}

type PollResult =
  | { status: 'pending' | 'slow_down' | 'expired' | 'error'; interval?: number; error?: string }
  | { status: 'success'; account_id: string }

export async function startDeviceFlow(): Promise<DeviceFlowResult> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      scope: 'read:user',
    }),
  })
  if (!res.ok) {
    throw new Error(`GitHub Device Flow failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as any
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval: data.interval ?? 5,
    expires_in: data.expires_in ?? 900,
  }
}

export async function pollDeviceFlow(device_code: string, name?: string): Promise<PollResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })

  const data = (await res.json()) as any

  if (data.error) {
    switch (data.error) {
      case 'authorization_pending':
        return { status: 'pending' }
      case 'slow_down':
        return { status: 'slow_down', interval: (data.interval ?? 5) + 5 }
      case 'expired_token':
        return { status: 'expired' }
      default:
        return { status: 'error', error: data.error_description ?? data.error }
    }
  }

  const access_token = data.access_token as string

  const userRes = await fetch(`${config.githubApiBase}/user`, {
    headers: {
      Authorization: `token ${access_token}`,
      'User-Agent': 'GitHubCopilotChat/0.26.7',
    },
  })
  const userData = (await userRes.json()) as any
  const github_login = userData.login as string

  const account = await createAccount({
    name: name ?? github_login,
    oauth_token: access_token,
    github_login,
  })

  return { status: 'success', account_id: account!.id }
}

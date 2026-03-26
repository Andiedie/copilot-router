import { nanoid } from "nanoid"
import { db } from "../db"
import { requests } from "../db/schema"
import { updateAccountQuota } from "../account"
import { checkAndAutoDisable } from "../quota/auto"

const NON_PREMIUM_RE = /^(gpt-4o|gpt-5-mini|gpt-4\.1|text-embedding|whisper|dall-e)/

export interface LogRequestParams {
  apiKeyId: string
  accountId: string | null
  model: string
  endpoint: string
  statusCode: number
  durationMs: number
  ratelimitRemaining: number | null
  ratelimitLimit: number | null
  ratelimitReset: number | null
  error?: string | null
}

export function logRequest(params: LogRequestParams): void {
  const isPremium = params.model !== "unknown" && !NON_PREMIUM_RE.test(params.model) ? 1 : 0
  const now = Math.floor(Date.now() / 1000)

  const work = async () => {
    try {
      db.insert(requests)
        .values({
          id: nanoid(),
          api_key_id: params.apiKeyId,
          account_id: params.accountId,
          model: params.model,
          endpoint: params.endpoint,
          status_code: params.statusCode,
          duration_ms: params.durationMs,
          is_premium: isPremium,
          ratelimit_remaining: params.ratelimitRemaining,
          ratelimit_limit: params.ratelimitLimit,
          error: params.error ?? null,
          created_at: now,
        })
        .run()

      // Passively update account quota from ratelimit headers
      if (
        params.accountId &&
        params.ratelimitLimit !== null &&
        params.ratelimitRemaining !== null
      ) {
        await updateAccountQuota(params.accountId, {
          quota_limit: params.ratelimitLimit,
          quota_used: params.ratelimitLimit - params.ratelimitRemaining,
          quota_reset_at: params.ratelimitReset,
        })
        await checkAndAutoDisable(params.accountId)
      }
    } catch (err) {
      console.error("[logger] Failed to log request:", err)
    }
  }

  void work()
}

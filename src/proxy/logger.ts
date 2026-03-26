import { nanoid } from "nanoid"
import { db } from "../db"
import { requests } from "../db/schema"

export interface LogRequestParams {
  apiKeyId: string
  accountId: string | null
  model: string
  endpoint: string
  statusCode: number
  durationMs: number
  error?: string | null
}

export function logRequest(params: LogRequestParams): void {
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
          error: params.error ?? null,
          created_at: now,
        })
        .run()
    } catch (err) {
      console.error("[logger] Failed to log request:", err)
    }
  }

  void work()
}

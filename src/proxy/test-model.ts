import type { Context } from "hono"

const TEST_MODEL_PATTERN = /^__test_model__(?:(\d+)(?:_(\d+))?__)?$/

const DEFAULT_DURATION_SEC = 300 // 5 minutes
const DEFAULT_INTERVAL_SEC = 10

export function isTestModel(model: string): boolean {
  return TEST_MODEL_PATTERN.test(model)
}

/**
 * - `__test_model__`       → { durationSec: 300, intervalSec: 10 }
 * - `__test_model__30__`   → { durationSec: 30,  intervalSec: 10 }
 * - `__test_model__30_5__` → { durationSec: 30,  intervalSec: 5  }
 */
export function parseTestModelConfig(model: string): {
  durationSec: number
  intervalSec: number
} {
  const match = model.match(TEST_MODEL_PATTERN)
  if (!match) {
    return { durationSec: DEFAULT_DURATION_SEC, intervalSec: DEFAULT_INTERVAL_SEC }
  }
  const durationSec = match[1] ? Number(match[1]) : DEFAULT_DURATION_SEC
  const intervalSec = match[2] ? Number(match[2]) : DEFAULT_INTERVAL_SEC
  return { durationSec, intervalSec }
}

function makeTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

function makeChunkId(): string {
  return `chatcmpl-test-${Date.now()}`
}

function buildNonStreamingResponse(model: string, durationSec: number): string {
  return JSON.stringify({
    id: makeChunkId(),
    object: "chat.completion",
    created: makeTimestamp(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `[test-model] Response after ${durationSec}s wait. Connection stayed alive.`,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  })
}

function sseData(payload: string): string {
  return `data: ${payload}\n\n`
}

function buildStreamChunk(
  chunkId: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: Record<string, unknown> | null,
): string {
  const chunk: Record<string, unknown> = {
    id: chunkId,
    object: "chat.completion.chunk",
    created: makeTimestamp(),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  }
  if (usage) {
    chunk.usage = usage
  }
  return sseData(JSON.stringify(chunk))
}

async function sleepWithAbortCheck(
  signal: AbortSignal,
  totalMs: number,
  checkIntervalMs: number = 1000,
): Promise<boolean> {
  let elapsed = 0
  while (elapsed < totalMs) {
    if (signal.aborted) return true
    const sleepTime = Math.min(checkIntervalMs, totalMs - elapsed)
    await Bun.sleep(sleepTime)
    elapsed += sleepTime
  }
  return signal.aborted
}

export async function handleTestModel(
  c: Context,
  model: string,
  isStream: boolean,
): Promise<Response> {
  const { durationSec, intervalSec } = parseTestModelConfig(model)
  const signal = c.req.raw.signal
  const startTime = performance.now()

  const elapsed = () => ((performance.now() - startTime) / 1000).toFixed(1)

  if (isStream) {
    return handleStreamingTestModel(model, durationSec, intervalSec, signal, elapsed)
  }
  return handleNonStreamingTestModel(c, model, durationSec, signal, elapsed)
}

async function handleNonStreamingTestModel(
  c: Context,
  model: string,
  durationSec: number,
  signal: AbortSignal,
  elapsed: () => string,
): Promise<Response> {
  console.log(
    `[test-model] Non-streaming request started: model=${model}, duration=${durationSec}s`,
  )

  const aborted = await sleepWithAbortCheck(signal, durationSec * 1000)

  if (aborted) {
    console.warn(
      `[test-model] Client disconnected during non-streaming wait after ${elapsed()}s`,
    )
    // Client is gone, but we still return a response (Hono/Bun will discard it)
    return new Response(JSON.stringify({ error: "Client disconnected" }), {
      status: 499,
      headers: { "content-type": "application/json" },
    })
  }

  const body = buildNonStreamingResponse(model, durationSec)
  console.log(
    `[test-model] Non-streaming response sent after ${elapsed()}s`,
  )

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  })
}

function handleStreamingTestModel(
  model: string,
  durationSec: number,
  intervalSec: number,
  signal: AbortSignal,
  elapsed: () => string,
): Response {
  const totalChunks = Math.ceil(durationSec / intervalSec)
  const chunkId = makeChunkId()

  console.log(
    `[test-model] Streaming request started: model=${model}, duration=${durationSec}s, interval=${intervalSec}s, totalChunks=${totalChunks}`,
  )

  const encoder = new TextEncoder()
  let chunkIndex = 0
  let aborted = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send initial chunk with role
      try {
        const initialChunk = buildStreamChunk(chunkId, model, { role: "assistant", content: "" }, null)
        controller.enqueue(encoder.encode(initialChunk))
        console.log(`[test-model] Sent initial role chunk at ${elapsed()}s`)
      } catch (err) {
        console.error(`[test-model] Error sending initial chunk: ${err}`)
        controller.close()
        return
      }

      // Send content chunks at intervals
      while (chunkIndex < totalChunks) {
        if (signal.aborted) {
          aborted = true
          console.warn(
            `[test-model] Client disconnected during streaming at chunk ${chunkIndex}/${totalChunks} after ${elapsed()}s`,
          )
          break
        }

        await Bun.sleep(intervalSec * 1000)

        if (signal.aborted) {
          aborted = true
          console.warn(
            `[test-model] Client disconnected during streaming at chunk ${chunkIndex}/${totalChunks} after ${elapsed()}s`,
          )
          break
        }

        chunkIndex++
        const content = `[chunk ${chunkIndex}/${totalChunks} at ${elapsed()}s] `

        try {
          const chunk = buildStreamChunk(chunkId, model, { content }, null)
          controller.enqueue(encoder.encode(chunk))
          console.log(`[test-model] Sent chunk ${chunkIndex}/${totalChunks} at ${elapsed()}s`)
        } catch (err) {
          console.warn(`[test-model] Error sending chunk ${chunkIndex}: ${err}`)
          aborted = true
          break
        }
      }

      // Send finish + usage + [DONE] if not aborted
      if (!aborted && !signal.aborted) {
        try {
          // Final chunk with finish_reason
          const finishChunk = buildStreamChunk(chunkId, model, {}, "stop")
          controller.enqueue(encoder.encode(finishChunk))

          // Usage chunk
          const usageChunk = buildStreamChunk(chunkId, model, {}, null, {
            prompt_tokens: 10,
            completion_tokens: totalChunks,
            total_tokens: 10 + totalChunks,
          })
          controller.enqueue(encoder.encode(usageChunk))

          // [DONE]
          controller.enqueue(encoder.encode(sseData("[DONE]")))

          console.log(
            `[test-model] Streaming completed: ${totalChunks} chunks over ${elapsed()}s`,
          )
        } catch (err) {
          console.warn(`[test-model] Error sending final chunks: ${err}`)
        }
      }

      try {
        controller.close()
      } catch {
        // Already closed
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  })
}

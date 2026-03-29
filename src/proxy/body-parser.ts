/**
 * Extract model name from raw JSON request body using regex.
 * Returns null if not found or body cannot be parsed.
 */
export function extractModelFromBody(body: string): string | null {
  const match = body.match(/"model"\s*:\s*"([^"]+)"/)
  return match ? match[1] : null
}

/**
 * Returns the path as-is as the endpoint identifier.
 * e.g. "/v1/chat/completions" → "/v1/chat/completions"
 */
export function detectEndpoint(path: string): string {
  return path
}

/**
 * Returns true if this path supports streaming (SSE) responses.
 */
export function isStreamableEndpoint(path: string): boolean {
  return path.includes("/chat/completions") || path.includes("/responses")
}

/**
 * Clones the request, reads the body text, extracts model and endpoint.
 * Safe — never throws; returns nulls on failure.
 */
export async function extractRequestInfo(
  request: Request,
  path: string
): Promise<{ model: string | null; endpoint: string }> {
  const endpoint = detectEndpoint(path)
  try {
    const body = await request.clone().text()
    const model = extractModelFromBody(body)
    return { model, endpoint }
  } catch {
    return { model: null, endpoint }
  }
}

export function injectStreamUsageOption(bodyText: string): string | null {
  if (!/"stream"\s*:\s*true/.test(bodyText)) {
    return null
  }

  try {
    if (/"stream_options"/.test(bodyText)) {
      if (/"include_usage"\s*:\s*true/.test(bodyText)) {
        return null
      }
      return bodyText.replace(
        /"stream_options"\s*:\s*\{([^}]*)\}/,
        (match, inner) => `"stream_options":{${inner.trimEnd().replace(/,?\s*$/, "")},"include_usage":true}`
      )
    }

    const lastBrace = bodyText.lastIndexOf("}")
    if (lastBrace === -1) return null
    return bodyText.slice(0, lastBrace) + ',"stream_options":{"include_usage":true}' + bodyText.slice(lastBrace)
  } catch {
    return null
  }
}

/**
 * Extracts token usage and model from a non-streaming response body.
 * Supports both /chat/completions and /responses endpoint formats.
 * Returns null on failure or non-2xx responses.
 * IMPORTANT: clones the response before reading to preserve the original.
 */
export async function extractUsageFromResponse(
  response: Response,
  endpoint: string
): Promise<{ model: string | null; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null } | null> {
  // Only parse 2xx responses — error responses don't have usage data
  if (response.status < 200 || response.status >= 300) {
    return null
  }
  try {
    const text = await response.clone().text()
    const json = JSON.parse(text)
    const model: string | null = json.model ?? null
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let cachedInputTokens: number | null = null
    const usage = json.usage
    if (usage) {
      if (endpoint.includes("/chat/completions")) {
        // OpenAI chat completions format
        inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null
        outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null
        cachedInputTokens = typeof usage.prompt_tokens_details?.cached_tokens === "number" ? usage.prompt_tokens_details.cached_tokens : null
      } else if (endpoint.includes("/responses")) {
        // OpenAI responses format
        inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : null
        outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : null
        cachedInputTokens = typeof usage.input_tokens_details?.cached_tokens === "number" ? usage.input_tokens_details.cached_tokens : null
      }
    }
    return { model, inputTokens, outputTokens, cachedInputTokens }
  } catch {
    return null
  }
}

export function createStreamTap(
  endpoint: string,
  onUsage: (usage: { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; model: string | null }) => void
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let lineBuffer = ""
  let usageCalled = false

  function processLine(line: string): void {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return
    try {
      const jsonStr = line.slice("data: ".length)
      const chunk = JSON.parse(jsonStr)

      if (endpoint.includes("/chat/completions")) {
        if (chunk.usage) {
          const inputTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : null
          const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : null
          const cachedInputTokens = typeof chunk.usage.prompt_tokens_details?.cached_tokens === "number" ? chunk.usage.prompt_tokens_details.cached_tokens : null
          const model: string | null = chunk.model ?? null
          if ((inputTokens !== null || outputTokens !== null || cachedInputTokens !== null) && !usageCalled) {
            usageCalled = true
            onUsage({ inputTokens, outputTokens, cachedInputTokens, model })
          }
        }
      } else if (endpoint.includes("/responses")) {
        if (
          (chunk.type === "response.completed" || chunk.type === "response.incomplete") &&
          chunk.response?.usage
        ) {
          const u = chunk.response.usage
          const inputTokens = typeof u.input_tokens === "number" ? u.input_tokens : null
          const outputTokens = typeof u.output_tokens === "number" ? u.output_tokens : null
          const cachedInputTokens = typeof u.input_tokens_details?.cached_tokens === "number" ? u.input_tokens_details.cached_tokens : null
          const model: string | null = chunk.response?.model ?? null
          if (!usageCalled) {
            usageCalled = true
            onUsage({ inputTokens, outputTokens, cachedInputTokens, model })
          }
        }
      }
    } catch {
      console.warn("[stream-tap] Failed to parse SSE data line as JSON")
    }
  }

  function processBuffer(): void {
    const lines = lineBuffer.split("\n")
    lineBuffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        try {
          processLine(trimmed)
        } catch (err) {
          console.warn("[stream-tap] Error processing SSE line:", err)
        }
      }
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      lineBuffer += decoder.decode(chunk, { stream: true })
      processBuffer()
    },
    flush(controller) {
      lineBuffer += decoder.decode()
      if (lineBuffer.trim()) {
        try {
          processLine(lineBuffer.trim())
        } catch (err) {
          console.warn("[stream-tap] Error processing final SSE line:", err)
        }
      }
      lineBuffer = ""
    },
  })
}

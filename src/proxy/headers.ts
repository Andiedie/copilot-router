// Copilot client identity headers — injected only when the client hasn't already provided them.
// Values reflect the latest VS Code Copilot Chat release (v0.42.2026032501, VS Code 1.114.0).
export const COPILOT_IDENTITY_HEADERS: Record<string, string> = {
  "user-agent":              "GitHubCopilotChat/0.42.2026032501",
  "editor-version":          "vscode/1.114.0",
  "editor-plugin-version":   "copilot-chat/0.42.2026032501",
  "copilot-integration-id":  "vscode-chat",
}

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "authorization",
])

export function buildUpstreamHeaders(
  clientHeaders: Headers,
  jwt: string,
): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const [key, value] of clientHeaders.entries()) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers[key.toLowerCase()] = value
    }
  }

  for (const [key, value] of Object.entries(COPILOT_IDENTITY_HEADERS)) {
    if (!headers[key]) {
      headers[key] = value
    }
  }

  headers["authorization"] = `Bearer ${jwt}`

  return headers
}

export const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.26.7",
  "Editor-Version": "vscode/1.99.3",
  "Editor-Plugin-Version": "copilot-chat/0.26.7",
  "Copilot-Integration-Id": "vscode-chat",
} as const

const PASSTHROUGH_HEADERS = [
  "content-type",
  "accept",
  "openai-intent",
  "x-initiator",
  "copilot-vision-request",
  "x-request-id",
] as const

export function buildUpstreamHeaders(
  clientHeaders: Headers,
  jwt: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...COPILOT_HEADERS,
    Authorization: `Bearer ${jwt}`,
  }

  for (const name of PASSTHROUGH_HEADERS) {
    const value = clientHeaders.get(name)
    if (value) {
      headers[name] = value
    }
  }

  return headers
}

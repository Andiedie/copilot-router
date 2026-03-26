import { mkdirSync } from "node:fs";

if (!process.env.ADMIN_TOKEN) {
  throw new Error("ADMIN_TOKEN environment variable is required");
}

mkdirSync("data", { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 4141),
  adminToken: process.env.ADMIN_TOKEN,
  dbPath: process.env.DB_PATH ?? "./data/copilot-router.db",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "Iv1.b507a08c87ecfe98",
  copilotApiBase:
    process.env.COPILOT_API_BASE ?? "https://api.githubcopilot.com",
  githubApiBase: process.env.GITHUB_API_BASE ?? "https://api.github.com",
  tokenRefreshBuffer: Number(process.env.TOKEN_REFRESH_BUFFER ?? 0.8),
  testModel: process.env.TEST_MODEL ?? "gpt-5-mini",
};

import { integer, index, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  github_login: text("github_login"),
  oauth_token: text("oauth_token").notNull(),
  status: text("status").notNull().default("active"),
  quota_limit: integer("quota_limit").notNull().default(0),
  quota_used: integer("quota_used").notNull().default(0),
  last_used_at: integer("last_used_at"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
})

export const api_keys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  account_id: text("account_id"),
  created_at: integer("created_at").notNull(),
  last_used_at: integer("last_used_at"),
  total_requests: integer("total_requests").notNull().default(0),
})

export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    api_key_id: text("api_key_id").notNull(),
    account_id: text("account_id"),
    model: text("model"),
    endpoint: text("endpoint"),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    cached_input_tokens: integer("cached_input_tokens"),
    status_code: integer("status_code"),
    duration_ms: integer("duration_ms"),
    error: text("error"),
    created_at: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_requests_api_key_id").on(t.api_key_id),
    index("idx_requests_account_id").on(t.account_id),
    index("idx_requests_model").on(t.model),
    index("idx_requests_created_at").on(t.created_at),
    index("idx_requests_status_code").on(t.status_code),
  ],
)

export const model_pricing = sqliteTable(
  "model_pricing",
  {
    id: text("id").primaryKey(),
    copilot_model_name: text("copilot_model_name").notNull().unique(),
    openrouter_model_id: text("openrouter_model_id"),
    display_name: text("display_name"),
    prompt_price: text("prompt_price").notNull(),
    completion_price: text("completion_price").notNull(),
    cache_read_price: text("cache_read_price"),
    source: text("source").notNull(),
    last_synced_at: integer("last_synced_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (t) => [index("idx_model_pricing_copilot_name").on(t.copilot_model_name)],
)

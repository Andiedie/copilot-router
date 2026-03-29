import { sql } from "drizzle-orm"
import { db } from "../db"

export interface OverviewResult {
  total_requests: number
  today_requests: number
  error_requests: number
  active_accounts: number
  total_accounts: number
  active_keys: number
  quota_usage_pct: number
  today_input_tokens: number
  today_output_tokens: number
  today_total_tokens: number
  today_cached_input_tokens: number
  avg_duration_ms: number
  success_rate: number
  today_models: number
}

export interface StatsParams {
  group_by: 'api_key' | 'account' | 'hour' | 'day' | 'status_code' | 'model'
  from?: number
  to?: number
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'
  api_key_id?: string
  account_id?: string
  model?: string
}

export interface StatsRow {
  label: string
  count: number
}

export interface TimeSeriesParams {
  interval: 'hour' | 'day' | 'week'
  from?: number
  to?: number
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'
  api_key_id?: string
  account_id?: string
  model?: string
}

export interface TimeSeriesRow {
  time: string
  count: number
}

export interface RequestLogParams {
  page: number
  limit: number
  api_key_id?: string
  account_id?: string
  status_code?: number
  model?: string
}

export interface RequestLogResult {
  items: Array<{
    id: string
    api_key_name: string | null
    account_name: string | null
    status_code: number | null
    duration_ms: number | null
    error: string | null
    model: string | null
    endpoint: string | null
    input_tokens: number | null
    output_tokens: number | null
    created_at: number
  }>
  total: number
  page: number
}

type Period = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'

function startOfToday(): number {
  const now = new Date()
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor(localMidnight.getTime() / 1000)
}

function periodToRange(period: Period): { from: number; to: number } {
  const now = Math.floor(Date.now() / 1000)
  const todayStart = startOfToday()
  const DAY = 86400

  switch (period) {
    case 'today':
      return { from: todayStart, to: now }
    case 'yesterday':
      return { from: todayStart - DAY, to: todayStart }
    case 'this_week':
      return { from: now - 7 * DAY, to: now }
    case 'this_month':
      return { from: now - 30 * DAY, to: now }
    case 'last_30_days':
      return { from: now - 30 * DAY, to: now }
  }
}

function resolveTimeRange(params: { from?: number; to?: number; period?: Period }): { from: number; to: number } | null {
  if (params.period) return periodToRange(params.period)
  if (params.from || params.to) {
    const now = Math.floor(Date.now() / 1000)
    return { from: params.from ?? 0, to: params.to ?? now }
  }
  return null
}

function intervalFmt(interval: 'hour' | 'day' | 'week'): string {
  switch (interval) {
    case 'hour':
      return `strftime('%Y-%m-%dT%H:00:00', r.created_at, 'unixepoch', 'localtime')`
    case 'day':
      return `strftime('%Y-%m-%dT00:00:00', r.created_at, 'unixepoch', 'localtime')`
    case 'week':
      return `strftime('%Y-%m-%dT00:00:00', r.created_at, 'unixepoch', 'localtime', 'weekday 0', '-6 days')`
  }
}

function buildWhereClause(range: { from: number; to: number } | null, filters: { api_key_id?: string; account_id?: string; status_code?: number; model?: string }): string {
  const clauses: string[] = []
  if (range) {
    clauses.push(`r.created_at >= ${range.from}`)
    clauses.push(`r.created_at <= ${range.to}`)
  }
  if (filters.api_key_id) clauses.push(`r.api_key_id = '${escSql(filters.api_key_id)}'`)
  if (filters.account_id) clauses.push(`r.account_id = '${escSql(filters.account_id)}'`)
  if (filters.status_code != null) clauses.push(`r.status_code = ${Number(filters.status_code)}`)
  if (filters.model) clauses.push(`r.model = '${escSql(filters.model)}'`)

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

function escSql(v: string): string {
  return v.replace(/'/g, "''")
}

export async function getOverview(): Promise<OverviewResult> {
  const todayStart = startOfToday()

  const [reqStats] = db.all<{
    total_requests: number
    today_requests: number
    error_requests: number
    today_input_tokens: number
    today_output_tokens: number
    today_cached_input_tokens: number
    avg_duration_ms: number
    success_rate: number
    today_models: number
  }>(sql`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END) as today_requests,
      SUM(CASE WHEN status_code >= 400 AND created_at >= ${todayStart} THEN 1 ELSE 0 END) as error_requests,
      SUM(CASE WHEN created_at >= ${todayStart} THEN COALESCE(input_tokens, 0) ELSE 0 END) as today_input_tokens,
      SUM(CASE WHEN created_at >= ${todayStart} THEN COALESCE(output_tokens, 0) ELSE 0 END) as today_output_tokens,
      SUM(CASE WHEN created_at >= ${todayStart} THEN COALESCE(cached_input_tokens, 0) ELSE 0 END) as today_cached_input_tokens,
      ROUND(AVG(CASE WHEN created_at >= ${todayStart} AND duration_ms IS NOT NULL THEN duration_ms ELSE NULL END), 2) as avg_duration_ms,
      CASE WHEN SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END) = 0 THEN 100.0
           ELSE ROUND(SUM(CASE WHEN created_at >= ${todayStart} AND (status_code IS NULL OR status_code < 400) THEN 1.0 ELSE 0.0 END) * 100.0 / SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END), 2)
      END as success_rate,
      COUNT(DISTINCT CASE WHEN created_at >= ${todayStart} THEN model ELSE NULL END) as today_models
    FROM requests
  `)

  const [accStats] = db.all<{
    total_accounts: number
    active_accounts: number
    quota_usage_pct: number
  }>(sql`
    SELECT
      COUNT(*) as total_accounts,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_accounts,
      COALESCE(
        AVG(CASE WHEN quota_limit > 0 THEN CAST(quota_used AS REAL) / quota_limit ELSE NULL END) * 100,
        0
      ) as quota_usage_pct
    FROM accounts
  `)

  const [keyStats] = db.all<{ active_keys: number }>(sql`
    SELECT COUNT(*) as active_keys FROM api_keys WHERE status = 'active'
  `)

  return {
    total_requests: reqStats?.total_requests ?? 0,
    today_requests: reqStats?.today_requests ?? 0,
    error_requests: reqStats?.error_requests ?? 0,
    active_accounts: accStats?.active_accounts ?? 0,
    total_accounts: accStats?.total_accounts ?? 0,
    active_keys: keyStats?.active_keys ?? 0,
    quota_usage_pct: Math.round((accStats?.quota_usage_pct ?? 0) * 100) / 100,
    today_input_tokens: reqStats?.today_input_tokens ?? 0,
    today_output_tokens: reqStats?.today_output_tokens ?? 0,
    today_total_tokens: (reqStats?.today_input_tokens ?? 0) + (reqStats?.today_output_tokens ?? 0),
    today_cached_input_tokens: reqStats?.today_cached_input_tokens ?? 0,
    avg_duration_ms: reqStats?.avg_duration_ms ?? 0,
    success_rate: reqStats?.success_rate ?? 100,
    today_models: reqStats?.today_models ?? 0,
  }
}

export async function getStats(params: StatsParams): Promise<StatsRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  let selectExpr: string
  let joinClause = ''
  let groupExpr: string

  switch (params.group_by) {
    case 'api_key':
      selectExpr = `COALESCE(k.name, r.api_key_id) as label`
      joinClause = 'LEFT JOIN api_keys k ON k.id = r.api_key_id'
      groupExpr = 'r.api_key_id'
      break
    case 'account':
      selectExpr = `COALESCE(a.name, r.account_id, 'unknown') as label`
      joinClause = 'LEFT JOIN accounts a ON a.id = r.account_id'
      groupExpr = 'r.account_id'
      break
    case 'hour':
      selectExpr = `strftime('%Y-%m-%dT%H:00:00', r.created_at, 'unixepoch', 'localtime') as label`
      groupExpr = `strftime('%Y-%m-%dT%H:00:00', r.created_at, 'unixepoch', 'localtime')`
      break
    case 'day':
      selectExpr = `strftime('%Y-%m-%d', r.created_at, 'unixepoch', 'localtime') as label`
      groupExpr = `strftime('%Y-%m-%d', r.created_at, 'unixepoch', 'localtime')`
      break
    case 'status_code':
      selectExpr = `CAST(COALESCE(r.status_code, 0) AS TEXT) as label`
      groupExpr = 'r.status_code'
      break
    case 'model':
      selectExpr = `COALESCE(r.model, 'unknown') as label`
      groupExpr = 'r.model'
      break
  }

  const query = `
    SELECT
      ${selectExpr},
      COUNT(*) as count
    FROM requests r
    ${joinClause}
    ${where}
    GROUP BY ${groupExpr}
    ORDER BY count DESC
  `

  const rows = db.all<{ label: string; count: number }>(sql.raw(query))

  return rows.map(r => ({
    label: String(r.label ?? 'unknown'),
    count: r.count ?? 0,
  }))
}

export async function getTimeSeries(params: TimeSeriesParams): Promise<TimeSeriesRow[]> {
  const range = resolveTimeRange(params) ?? periodToRange('last_30_days')
  const where = buildWhereClause(range, params)

  const fmt = intervalFmt(params.interval)

  const query = `
    SELECT
      ${fmt} as time,
      COUNT(*) as count
    FROM requests r
    ${where}
    GROUP BY time
    ORDER BY time ASC
  `

  const rows = db.all<{ time: string; count: number }>(sql.raw(query))

  return rows.map(r => ({
    time: r.time,
    count: r.count ?? 0,
  }))
}

export interface TokenTimeSeriesRow {
  time: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
}

export async function getTokenTimeSeries(params: TimeSeriesParams): Promise<TokenTimeSeriesRow[]> {
  const range = resolveTimeRange(params) ?? periodToRange('last_30_days')
  const where = buildWhereClause(range, params)

  const fmt = intervalFmt(params.interval)

  const query = `
    SELECT
      ${fmt} as time,
      SUM(COALESCE(input_tokens, 0)) as input_tokens,
      SUM(COALESCE(output_tokens, 0)) as output_tokens,
      SUM(COALESCE(cached_input_tokens, 0)) as cached_input_tokens
    FROM requests r
    ${where}
    GROUP BY time
    ORDER BY time ASC
  `

  const rows = db.all<{ time: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }>(sql.raw(query))

  return rows.map(r => ({
    time: r.time,
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cached_input_tokens: r.cached_input_tokens ?? 0,
  }))
}

export interface ModelStatsRow {
  model: string
  count: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  avg_duration_ms: number
}

export interface ModelStatsParams {
  from?: number
  to?: number
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'
  api_key_id?: string
  model?: string
}

export async function getModelStats(params: ModelStatsParams): Promise<ModelStatsRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  const query = `
    SELECT
      COALESCE(r.model, 'unknown') as model,
      COUNT(*) as count,
      SUM(COALESCE(r.input_tokens, 0)) as input_tokens,
      SUM(COALESCE(r.output_tokens, 0)) as output_tokens,
      SUM(COALESCE(r.cached_input_tokens, 0)) as cached_input_tokens,
      ROUND(AVG(CASE WHEN r.duration_ms IS NOT NULL THEN r.duration_ms ELSE NULL END), 2) as avg_duration_ms
    FROM requests r
    ${where}
    GROUP BY r.model
    ORDER BY count DESC
  `

  const rows = db.all<{
    model: string
    count: number
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    avg_duration_ms: number
  }>(sql.raw(query))

  return rows.map(r => ({
    model: String(r.model ?? 'unknown'),
    count: r.count ?? 0,
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cached_input_tokens: r.cached_input_tokens ?? 0,
    avg_duration_ms: r.avg_duration_ms ?? 0,
  }))
}

export interface KeyModelTimeSeriesRow {
  time: string
  key_name: string
  model: string
  count: number
}

export async function getKeyModelTimeSeries(params: TimeSeriesParams): Promise<KeyModelTimeSeriesRow[]> {
  const range = resolveTimeRange(params) ?? periodToRange('last_30_days')
  const where = buildWhereClause(range, params)

  const fmt = intervalFmt(params.interval)

  const query = `
    SELECT
      ${fmt} as time,
      COALESCE(k.name, r.api_key_id, 'unknown') as key_name,
      COALESCE(r.model, 'unknown') as model,
      COUNT(*) as count
    FROM requests r
    LEFT JOIN api_keys k ON k.id = r.api_key_id
    ${where}
    GROUP BY time, r.api_key_id, r.model
    ORDER BY time ASC
  `

  const rows = db.all<{ time: string; key_name: string; model: string; count: number }>(sql.raw(query))

  return rows.map(r => ({
    time: r.time,
    key_name: String(r.key_name ?? 'unknown'),
    model: String(r.model ?? 'unknown'),
    count: r.count ?? 0,
  }))
}

export interface ModelTokenTimeSeriesRow {
  time: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
}

export async function getModelTokenTimeSeries(params: TimeSeriesParams): Promise<ModelTokenTimeSeriesRow[]> {
  const range = resolveTimeRange(params) ?? periodToRange('last_30_days')
  const where = buildWhereClause(range, params)

  const fmt = intervalFmt(params.interval)

  const query = `
    SELECT
      ${fmt} as time,
      COALESCE(r.model, 'unknown') as model,
      SUM(COALESCE(input_tokens, 0)) as input_tokens,
      SUM(COALESCE(output_tokens, 0)) as output_tokens,
      SUM(COALESCE(cached_input_tokens, 0)) as cached_input_tokens
    FROM requests r
    ${where}
    GROUP BY time, r.model
    ORDER BY time ASC
  `

  const rows = db.all<{ time: string; model: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }>(sql.raw(query))

  return rows.map(r => ({
    time: r.time,
    model: String(r.model ?? 'unknown'),
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cached_input_tokens: r.cached_input_tokens ?? 0,
  }))
}

export async function getRequestLog(params: RequestLogParams): Promise<RequestLogResult> {
  const page = Math.max(1, params.page)
  const limit = Math.min(100, Math.max(1, params.limit))
  const offset = (page - 1) * limit

  const where = buildWhereClause(null, {
    api_key_id: params.api_key_id,
    account_id: params.account_id,
    status_code: params.status_code,
    model: params.model,
  })

  const countQuery = `SELECT COUNT(*) as total FROM requests r ${where}`
  const [countRow] = db.all<{ total: number }>(sql.raw(countQuery))
  const total = countRow?.total ?? 0

  const dataQuery = `
    SELECT
      r.id,
      k.name as api_key_name,
      a.name as account_name,
      r.status_code, r.duration_ms,
      r.error, r.model, r.endpoint, r.input_tokens, r.output_tokens, r.created_at
    FROM requests r
    LEFT JOIN api_keys k ON k.id = r.api_key_id
    LEFT JOIN accounts a ON a.id = r.account_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `

  const items = db.all<{
    id: string
    api_key_name: string | null
    account_name: string | null
    status_code: number | null
    duration_ms: number | null
    error: string | null
    model: string | null
    endpoint: string | null
    input_tokens: number | null
    output_tokens: number | null
    created_at: number
  }>(sql.raw(dataQuery))

  return { items, total, page }
}

export interface KeyTokenStatsRow {
  key_name: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
}

export interface KeyTokenStatsParams {
  from?: number
  to?: number
  period?: Period
  api_key_id?: string
  model?: string
}

export async function getKeyTokenStats(params: KeyTokenStatsParams): Promise<KeyTokenStatsRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  const query = `
    SELECT
      COALESCE(k.name, r.api_key_id, 'unknown') as key_name,
      SUM(COALESCE(r.input_tokens, 0)) as input_tokens,
      SUM(COALESCE(r.output_tokens, 0)) as output_tokens,
      SUM(COALESCE(r.cached_input_tokens, 0)) as cached_input_tokens
    FROM requests r
    LEFT JOIN api_keys k ON k.id = r.api_key_id
    ${where}
    GROUP BY r.api_key_id
    ORDER BY (input_tokens + output_tokens) DESC
  `

  const rows = db.all<{ key_name: string; input_tokens: number; output_tokens: number; cached_input_tokens: number }>(sql.raw(query))

  return rows.map(r => ({
    key_name: String(r.key_name ?? 'unknown'),
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cached_input_tokens: r.cached_input_tokens ?? 0,
  }))
}

export interface HeatmapRow {
  day_of_week: number
  hour: number
  count: number
}

export interface HeatmapParams {
  from?: number
  to?: number
  period?: Period
  api_key_id?: string
  model?: string
}

export async function getHourlyHeatmap(params: HeatmapParams): Promise<HeatmapRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  const query = `
    SELECT
      CAST(strftime('%w', r.created_at, 'unixepoch', 'localtime') AS INTEGER) as day_of_week,
      CAST(strftime('%H', r.created_at, 'unixepoch', 'localtime') AS INTEGER) as hour,
      COUNT(*) as count
    FROM requests r
    ${where}
    GROUP BY day_of_week, hour
    ORDER BY day_of_week ASC, hour ASC
  `

  const rows = db.all<{ day_of_week: number; hour: number; count: number }>(sql.raw(query))

  return rows.map(r => ({
    day_of_week: r.day_of_week ?? 0,
    hour: r.hour ?? 0,
    count: r.count ?? 0,
  }))
}

export async function getDistinctModels(): Promise<string[]> {
  const query = `SELECT DISTINCT model FROM requests WHERE model IS NOT NULL ORDER BY model ASC`
  const rows = db.all<{ model: string }>(sql.raw(query))
  return rows.map(r => r.model)
}

export interface CacheRateByModelRow {
  model: string
  count: number
  cached_input_tokens: number
  input_tokens: number
  cache_rate: number
}

export interface CacheRateByModelParams {
  from?: number
  to?: number
  period?: Period
  api_key_id?: string
  model?: string
}

export async function getCacheRateByModel(params: CacheRateByModelParams): Promise<CacheRateByModelRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  const query = `
    SELECT
      COALESCE(r.model, 'unknown') as model,
      COUNT(*) as count,
      SUM(COALESCE(r.cached_input_tokens, 0)) as cached_input_tokens,
      SUM(COALESCE(r.input_tokens, 0)) as input_tokens,
      CASE WHEN SUM(COALESCE(r.input_tokens, 0)) = 0 THEN 0.0
           ELSE ROUND(CAST(SUM(COALESCE(r.cached_input_tokens, 0)) AS REAL) * 100.0 / SUM(COALESCE(r.input_tokens, 0)), 2)
      END as cache_rate
    FROM requests r
    ${where}
    GROUP BY r.model
    ORDER BY cache_rate DESC
  `

  const rows = db.all<{
    model: string
    count: number
    cached_input_tokens: number
    input_tokens: number
    cache_rate: number
  }>(sql.raw(query))

  return rows.map(r => ({
    model: String(r.model ?? 'unknown'),
    count: r.count ?? 0,
    cached_input_tokens: r.cached_input_tokens ?? 0,
    input_tokens: r.input_tokens ?? 0,
    cache_rate: r.cache_rate ?? 0,
  }))
}

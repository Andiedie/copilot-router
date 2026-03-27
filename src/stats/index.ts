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
}

export interface StatsParams {
  group_by: 'model' | 'api_key' | 'account' | 'hour' | 'day' | 'status_code'
  from?: number
  to?: number
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'
  model?: string
  api_key_id?: string
  account_id?: string
}

export interface StatsRow {
  label: string
  count: number
}

export interface TimeSeriesParams {
  interval: 'hour' | 'day'
  from?: number
  to?: number
  period?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'
  model?: string
  api_key_id?: string
  account_id?: string
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
  model?: string
  status_code?: number
}

export interface RequestLogResult {
  items: Array<{
    id: string
    api_key_name: string | null
    account_name: string | null
    model: string | null
    status_code: number | null
    duration_ms: number | null
    error: string | null
    created_at: number
  }>
  total: number
  page: number
}

type Period = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_30_days'

function startOfTodayUTC(): number {
  const now = new Date()
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor(utcMidnight / 1000)
}

function periodToRange(period: Period): { from: number; to: number } {
  const now = Math.floor(Date.now() / 1000)
  const todayStart = startOfTodayUTC()
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

function buildWhereClause(range: { from: number; to: number } | null, filters: { model?: string; api_key_id?: string; account_id?: string; status_code?: number }): string {
  const clauses: string[] = []
  if (range) {
    clauses.push(`r.created_at >= ${range.from}`)
    clauses.push(`r.created_at <= ${range.to}`)
  }
  if (filters.model) clauses.push(`r.model = '${escSql(filters.model)}'`)
  if (filters.api_key_id) clauses.push(`r.api_key_id = '${escSql(filters.api_key_id)}'`)
  if (filters.account_id) clauses.push(`r.account_id = '${escSql(filters.account_id)}'`)
  if (filters.status_code != null) clauses.push(`r.status_code = ${Number(filters.status_code)}`)

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
}

function escSql(v: string): string {
  return v.replace(/'/g, "''")
}

export async function getOverview(): Promise<OverviewResult> {
  const todayStart = startOfTodayUTC()

  const [reqStats] = db.all<{
    total_requests: number
    today_requests: number
    error_requests: number
  }>(sql`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN created_at >= ${todayStart} THEN 1 ELSE 0 END) as today_requests,
      SUM(CASE WHEN status_code >= 400 AND created_at >= ${todayStart} THEN 1 ELSE 0 END) as error_requests
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
  }
}

export async function getStats(params: StatsParams): Promise<StatsRow[]> {
  const range = resolveTimeRange(params)
  const where = buildWhereClause(range, params)

  let selectExpr: string
  let joinClause = ''
  let groupExpr: string

  switch (params.group_by) {
    case 'model':
      selectExpr = `COALESCE(r.model, 'unknown') as label`
      groupExpr = 'r.model'
      break
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
      selectExpr = `strftime('%Y-%m-%dT%H:00:00Z', r.created_at, 'unixepoch') as label`
      groupExpr = `strftime('%Y-%m-%dT%H:00:00Z', r.created_at, 'unixepoch')`
      break
    case 'day':
      selectExpr = `strftime('%Y-%m-%d', r.created_at, 'unixepoch') as label`
      groupExpr = `strftime('%Y-%m-%d', r.created_at, 'unixepoch')`
      break
    case 'status_code':
      selectExpr = `CAST(COALESCE(r.status_code, 0) AS TEXT) as label`
      groupExpr = 'r.status_code'
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

  const fmt = params.interval === 'hour'
    ? `strftime('%Y-%m-%dT%H:00:00Z', r.created_at, 'unixepoch')`
    : `strftime('%Y-%m-%dT00:00:00Z', r.created_at, 'unixepoch')`

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

export async function getRequestLog(params: RequestLogParams): Promise<RequestLogResult> {
  const page = Math.max(1, params.page)
  const limit = Math.min(100, Math.max(1, params.limit))
  const offset = (page - 1) * limit

  const where = buildWhereClause(null, {
    model: params.model,
    api_key_id: params.api_key_id,
    account_id: params.account_id,
    status_code: params.status_code,
  })

  const countQuery = `SELECT COUNT(*) as total FROM requests r ${where}`
  const [countRow] = db.all<{ total: number }>(sql.raw(countQuery))
  const total = countRow?.total ?? 0

  const dataQuery = `
    SELECT
      r.id,
      k.name as api_key_name,
      a.name as account_name,
      r.model,
      r.status_code, r.duration_ms,
      r.error, r.created_at
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
    model: string | null
    status_code: number | null
    duration_ms: number | null
    error: string | null
    created_at: number
  }>(sql.raw(dataQuery))

  return { items, total, page }
}

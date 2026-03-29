import { Hono } from 'hono'
import { config } from '../config'
import { listAccounts, getAccount, updateAccount, deleteAccount, setAccountStatus } from '../account'
import { startDeviceFlow, pollDeviceFlow } from '../account/oauth'
import { syncAccountQuota, syncAllQuotas, testAccount } from '../quota'
import { createApiKey, deleteApiKey, listApiKeys, setApiKeyStatus, clearApiKeyBinding } from '../auth'
import { getOverview, getStats, getTimeSeries, getRequestLog, getTokenTimeSeries, getModelStats, getKeyModelTimeSeries, getModelTokenTimeSeries, getDistinctModels, getKeyTokenStats, getHourlyHeatmap, getCacheRateByModel, getCacheRateByKey, getCostOverview, getCostTimeSeries, getCostByModel, getCostByKey, getCacheSavings } from '../stats'
import { getPoolStatus } from '../account/pool'
import type { StatsParams, TimeSeriesParams, RequestLogParams, ModelStatsParams, KeyTokenStatsParams, HeatmapParams, CacheRateByModelParams, CostModelParams } from '../stats'
import { syncFromOpenRouter, listPricing, updatePricing, deletePricing, createManualPricing, listOpenRouterModels } from '../pricing'

const adminApp = new Hono()

// Serve Dashboard UI — no auth required for the HTML shell (auth happens client-side)
adminApp.get('/', (c) => c.html(Bun.file(new URL('./ui/index.html', import.meta.url)).text()))
adminApp.get('/ui/*', async (c) => {
  const path = c.req.path.replace('/admin/ui/', '')
  return c.html(await Bun.file(new URL(`./ui/${path}`, import.meta.url)).text())
})

// Strip oauth_token from account objects
function sanitizeAccount<T extends Record<string, unknown>>(account: T): Omit<T, 'oauth_token'> {
  const { oauth_token, ...rest } = account as any
  return rest
}

// Admin auth middleware — all routes require Bearer ADMIN_TOKEN
adminApp.use('*', async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${config.adminToken}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// ─── Account Management ───

adminApp.get('/accounts', async (c) => {
  const accounts = await listAccounts()
  return c.json(accounts)
})

adminApp.post('/accounts/authorize', async (c) => {
  try {
    const result = await startDeviceFlow()
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message ?? String(err) }, 500)
  }
})

adminApp.post('/accounts/authorize/poll', async (c) => {
  const body = await c.req.json<{ device_code: string; name?: string }>()
  if (!body.device_code) {
    return c.json({ error: 'device_code is required' }, 400)
  }
  try {
    const result = await pollDeviceFlow(body.device_code, body.name)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message ?? String(err) }, 500)
  }
})

adminApp.get('/accounts/:id', async (c) => {
  const account = await getAccount(c.req.param('id'))
  if (!account) {
    return c.json({ error: 'Account not found' }, 404)
  }
  return c.json(sanitizeAccount(account))
})

adminApp.patch('/accounts/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; status?: 'active' | 'disabled' }>()
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'disabled') {
      return c.json({ error: 'Invalid status. Use active or disabled.' }, 400)
    }
    await setAccountStatus(id, body.status)
    const acct = await getAccount(id)
    if (!acct) return c.json({ error: 'Account not found' }, 404)
    return c.json(sanitizeAccount(acct))
  }
  const updated = await updateAccount(id, body)
  if (!updated) {
    return c.json({ error: 'Account not found' }, 404)
  }
  return c.json(sanitizeAccount(updated))
})

adminApp.delete('/accounts/:id', async (c) => {
  await deleteAccount(c.req.param('id'))
  return c.body(null, 204)
})

adminApp.post('/accounts/:id/sync', async (c) => {
  const result = await syncAccountQuota(c.req.param('id'))
  return c.json(result)
})

adminApp.post('/accounts/:id/test', async (c) => {
  const result = await testAccount(c.req.param('id'))
  return c.json(result)
})

adminApp.post('/accounts/sync-all', async (c) => {
  const result = await syncAllQuotas()
  return c.json(result)
})

// ─── API Key Management ───

adminApp.get('/keys', async (c) => {
  const keys = await listApiKeys()
  return c.json(keys)
})

adminApp.post('/keys', async (c) => {
  const body = await c.req.json<{ name: string }>()
  if (!body.name) {
    return c.json({ error: 'name is required' }, 400)
  }
  const result = await createApiKey(body.name)
  return c.json(result, 201)
})

adminApp.patch('/keys/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ status: 'active' | 'disabled' }>()
  if (body.status !== 'active' && body.status !== 'disabled') {
    return c.json({ error: 'status must be active or disabled' }, 400)
  }
  await setApiKeyStatus(id, body.status)
  return c.body(null, 204)
})

adminApp.delete('/keys/:id', async (c) => {
  await deleteApiKey(c.req.param('id'))
  return c.body(null, 204)
})

adminApp.post('/keys/:id/clear-binding', async (c) => {
  await clearApiKeyBinding(c.req.param('id'))
  return c.body(null, 204)
})

adminApp.get('/keys/:id/opencode-config', async (c) => {
  const id = c.req.param('id')
  const keys = await listApiKeys()
  const key = keys.find((k) => k.id === id)
  if (!key) {
    return c.json({ error: 'API key not found' }, 404)
  }

  const host = c.req.header('host')
  const baseURL = host ? `http://${host}` : `http://localhost:${config.port}`

  const opencodeJson = {
    provider: {
      'github-copilot': {
        options: { baseURL },
      },
    },
  }

  const authJson = {
    'github-copilot': {
      type: 'oauth',
      refresh: key.key,
      access: key.key,
      expires: 0,
    },
  }

  return c.json({
    opencodeJsonText: JSON.stringify(opencodeJson, null, 2),
    authJsonText: JSON.stringify(authJson, null, 2),
  })
})

// ─── Statistics ───

adminApp.get('/stats/overview', async (c) => {
  const overview = await getOverview()
  return c.json(overview)
})

adminApp.get('/stats', async (c) => {
  const query = c.req.query()
  const params: StatsParams = {
    group_by: (query.group_by as StatsParams['group_by']) ?? 'api_key',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as StatsParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const stats = await getStats(params)
  return c.json(stats)
})

adminApp.get('/stats/timeseries', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'hour',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const series = await getTimeSeries(params)
  return c.json(series)
})

adminApp.get('/stats/token-timeseries', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'hour',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const series = await getTokenTimeSeries(params)
  return c.json(series)
})

adminApp.get('/stats/models', async (c) => {
  const query = c.req.query()
  const params: ModelStatsParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as ModelStatsParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const models = await getModelStats(params)
  return c.json(models)
})

adminApp.get('/stats/distinct-models', async (c) => {
  const models = await getDistinctModels()
  return c.json(models)
})

adminApp.get('/stats/key-model-timeseries', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'hour',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const series = await getKeyModelTimeSeries(params)
  return c.json(series)
})

adminApp.get('/stats/key-tokens', async (c) => {
  const query = c.req.query()
  const params: KeyTokenStatsParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as KeyTokenStatsParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getKeyTokenStats(params)
  return c.json(data)
})

adminApp.get('/stats/heatmap', async (c) => {
  const query = c.req.query()
  const params: HeatmapParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as HeatmapParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getHourlyHeatmap(params)
  return c.json(data)
})

adminApp.get('/stats/cache-rate-by-model', async (c) => {
  const query = c.req.query()
  const params: CacheRateByModelParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as CacheRateByModelParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getCacheRateByModel(params)
  return c.json(data)
})

adminApp.get('/stats/cache-rate-by-key', async (c) => {
  const query = c.req.query()
  const params: CacheRateByModelParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as CacheRateByModelParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getCacheRateByKey(params)
  return c.json(data)
})

adminApp.get('/stats/model-token-timeseries', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'hour',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const series = await getModelTokenTimeSeries(params)
  return c.json(series)
})

adminApp.get('/requests', async (c) => {
  const query = c.req.query()
  const params: RequestLogParams = {
    page: query.page ? Number(query.page) : 1,
    limit: query.limit ? Number(query.limit) : 50,
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    status_code: query.status_code ? Number(query.status_code) : undefined,
    model: query.model,
  }
  const log = await getRequestLog(params)
  return c.json(log)
})

// ─── Pricing ───

adminApp.post('/pricing/sync', async (c) => {
  const result = await syncFromOpenRouter()
  if (!result.success) {
    return c.json({ error: result.error }, 500)
  }
  return c.json(result)
})

adminApp.get('/pricing', async (c) => {
  const result = await listPricing()
  return c.json(result)
})

adminApp.get('/pricing/openrouter-models', async (c) => {
  const result = await listOpenRouterModels()
  if (!result.success) {
    return c.json({ error: result.error }, 500)
  }
  return c.json({ models: result.models })
})

adminApp.post('/pricing', async (c) => {
  const body = await c.req.json<{
    copilot_model_name: string
    prompt_price: string
    completion_price: string
    cache_read_price?: string
    openrouter_model_id?: string
  }>()
  if (!body.copilot_model_name || !body.prompt_price || !body.completion_price) {
    return c.json({ error: 'copilot_model_name, prompt_price, completion_price are required' }, 400)
  }
  const result = await createManualPricing(
    body.copilot_model_name,
    body.prompt_price,
    body.completion_price,
    body.cache_read_price,
    body.openrouter_model_id,
  )
  if (!result.success) {
    return c.json({ error: result.error }, 500)
  }
  return c.json(result.created, 201)
})

adminApp.put('/pricing/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    copilot_model_name?: string
    openrouter_model_id?: string
    prompt_price?: string
    completion_price?: string
    cache_read_price?: string
    source?: string
  }>()
  const result = await updatePricing(id, body)
  if (!result.success) {
    if (result.error === 'Not found') return c.json({ error: 'Pricing entry not found' }, 404)
    return c.json({ error: result.error }, 500)
  }
  return c.json(result.updated)
})

adminApp.delete('/pricing/:id', async (c) => {
  const result = await deletePricing(c.req.param('id'))
  if (!result.success) {
    return c.json({ error: result.error }, 500)
  }
  return c.body(null, 204)
})

// ─── Cost Statistics ───

adminApp.get('/stats/cost-overview', async (c) => {
  const data = await getCostOverview()
  return c.json(data)
})

adminApp.get('/stats/cost-timeseries', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'day',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const data = await getCostTimeSeries(params)
  return c.json(data)
})

adminApp.get('/stats/cost-by-model', async (c) => {
  const query = c.req.query()
  const params: CostModelParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as CostModelParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getCostByModel(params)
  return c.json(data)
})

adminApp.get('/stats/cost-by-key', async (c) => {
  const query = c.req.query()
  const params: KeyTokenStatsParams = {
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as KeyTokenStatsParams['period'],
    api_key_id: query.api_key_id,
    model: query.model,
  }
  const data = await getCostByKey(params)
  return c.json(data)
})

adminApp.get('/stats/cache-savings', async (c) => {
  const query = c.req.query()
  const params: TimeSeriesParams = {
    interval: (query.interval as TimeSeriesParams['interval']) ?? 'day',
    from: query.from ? Number(query.from) : undefined,
    to: query.to ? Number(query.to) : undefined,
    period: query.period as TimeSeriesParams['period'],
    api_key_id: query.api_key_id,
    account_id: query.account_id,
    model: query.model,
  }
  const data = await getCacheSavings(params)
  return c.json(data)
})

// ─── System ───

adminApp.get('/health', (c) => {
  return c.json({ status: 'ok', uptime: process.uptime() })
})

adminApp.get('/pool-status', async (c) => {
  const status = await getPoolStatus()
  return c.json(status)
})

export { adminApp }

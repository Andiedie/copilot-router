import { sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db"

// ─── Types ───

export interface ModelPricingRow {
  id: string
  copilot_model_name: string
  openrouter_model_id: string | null
  display_name: string | null
  prompt_price: string
  completion_price: string
  cache_read_price: string | null
  source: string
  last_synced_at: number | null
  created_at: number
  updated_at: number
}

interface OpenRouterModel {
  id: string
  name: string
  pricing: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

// ─── Helpers ───

function escSql(v: string): string {
  return v.replace(/'/g, "''")
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

// ─── matchModelName ───

export function matchModelName(
  copilotName: string,
  openrouterModels: Array<{ id: string; name: string; pricing: any }>,
): { id: string; name: string; pricing: any } | null {
  // 1. Exact match
  const exact = openrouterModels.find((m) => m.id === copilotName)
  if (exact) return exact

  // 2. Suffix match: model.id ends with `/<copilotName>`
  const suffix = `/${copilotName}`
  const suffixMatches = openrouterModels.filter((m) => m.id.endsWith(suffix))

  if (suffixMatches.length === 1) return suffixMatches[0]

  // 3. If multiple suffix matches, pick shortest id (most canonical)
  if (suffixMatches.length > 1) {
    suffixMatches.sort((a, b) => a.id.length - b.id.length)
    return suffixMatches[0]
  }

  return null
}

// ─── syncFromOpenRouter ───

export async function syncFromOpenRouter(): Promise<
  | {
      success: true
      total_fetched: number
      synced: number
      new_matches: number
      unmatched_copilot_models: string[]
    }
  | { success: false; error: string }
> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models")
    if (!res.ok) {
      return { success: false, error: `OpenRouter API error: ${res.status}` }
    }

    const data = (await res.json()) as { data: OpenRouterModel[] }
    if (!data.data || !Array.isArray(data.data)) {
      return { success: false, error: "Invalid response format from OpenRouter" }
    }

    const models = data.data
    const totalFetched = models.length

    const pricedModels = models.filter(
      (m) => m.pricing && (m.pricing.prompt || m.pricing.completion),
    )

    const requestModels = db.all<{ model: string }>(
      sql.raw(`SELECT DISTINCT model FROM requests WHERE model IS NOT NULL`),
    )
    const copilotNames = requestModels.map((r) => r.model)

    const existingPricing = db.all<{ copilot_model_name: string }>(
      sql.raw(`SELECT copilot_model_name FROM model_pricing`),
    )
    const existingNames = new Set(existingPricing.map((r) => r.copilot_model_name))

    let synced = 0
    let newMatches = 0
    const matchedCopilotNames = new Set<string>()

    for (const copilotName of copilotNames) {
      const match = matchModelName(copilotName, pricedModels)
      if (match) {
        const isNew = !existingNames.has(copilotName)
        const ts = now()
        const promptPrice = match.pricing.prompt ?? "0"
        const completionPrice = match.pricing.completion ?? "0"
        const cacheReadPrice = match.pricing.input_cache_read ?? null

        const insertQuery = `
          INSERT OR REPLACE INTO model_pricing (id, copilot_model_name, openrouter_model_id, display_name, prompt_price, completion_price, cache_read_price, source, last_synced_at, created_at, updated_at)
          VALUES (
            COALESCE((SELECT id FROM model_pricing WHERE copilot_model_name = '${escSql(copilotName)}'), '${escSql(nanoid())}'),
            '${escSql(copilotName)}',
            '${escSql(match.id)}',
            '${escSql(match.name)}',
            '${escSql(promptPrice)}',
            '${escSql(completionPrice)}',
            ${cacheReadPrice ? `'${escSql(cacheReadPrice)}'` : "NULL"},
            'openrouter_auto',
            ${ts},
            COALESCE((SELECT created_at FROM model_pricing WHERE copilot_model_name = '${escSql(copilotName)}'), ${ts}),
            ${ts}
          )
        `
        db.run(sql.raw(insertQuery))
        synced++
        if (isNew) newMatches++
        matchedCopilotNames.add(copilotName)
      }
    }

    const unmatchedRows = db.all<{ model: string }>(
      sql.raw(`
        SELECT DISTINCT r.model
        FROM requests r
        WHERE r.model IS NOT NULL
          AND r.model NOT IN (SELECT copilot_model_name FROM model_pricing)
      `),
    )
    const unmatchedCopilotModels = unmatchedRows.map((r) => r.model)

    return {
      success: true,
      total_fetched: totalFetched,
      synced,
      new_matches: newMatches,
      unmatched_copilot_models: unmatchedCopilotModels,
    }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) }
  }
}

// ─── listPricing ───

export async function listPricing(): Promise<{
  pricing: ModelPricingRow[]
  unmatched_models: string[]
}> {
  const rows = db.all<ModelPricingRow>(
    sql.raw(`SELECT * FROM model_pricing ORDER BY copilot_model_name ASC`),
  )

  const unmatchedRows = db.all<{ model: string }>(
    sql.raw(`
      SELECT DISTINCT r.model
      FROM requests r
      WHERE r.model IS NOT NULL
        AND r.model NOT IN (SELECT copilot_model_name FROM model_pricing)
    `),
  )

  return {
    pricing: rows,
    unmatched_models: unmatchedRows.map((r) => r.model),
  }
}

// ─── updatePricing ───

export async function updatePricing(
  id: string,
  data: Partial<{
    copilot_model_name: string
    openrouter_model_id: string
    prompt_price: string
    completion_price: string
    cache_read_price: string
    source: string
  }>,
): Promise<
  | { success: true; updated: ModelPricingRow }
  | { success: false; error: string }
> {
  try {
    const setClauses: string[] = []

    if (data.copilot_model_name !== undefined)
      setClauses.push(`copilot_model_name = '${escSql(data.copilot_model_name)}'`)
    if (data.openrouter_model_id !== undefined)
      setClauses.push(`openrouter_model_id = '${escSql(data.openrouter_model_id)}'`)
    if (data.prompt_price !== undefined)
      setClauses.push(`prompt_price = '${escSql(data.prompt_price)}'`)
    if (data.completion_price !== undefined)
      setClauses.push(`completion_price = '${escSql(data.completion_price)}'`)
    if (data.cache_read_price !== undefined)
      setClauses.push(`cache_read_price = '${escSql(data.cache_read_price)}'`)
    if (data.source !== undefined)
      setClauses.push(`source = '${escSql(data.source)}'`)

    if (setClauses.length === 0) {
      return { success: false, error: "No fields to update" }
    }

    setClauses.push(`updated_at = ${now()}`)

    const query = `UPDATE model_pricing SET ${setClauses.join(", ")} WHERE id = '${escSql(id)}'`
    db.run(sql.raw(query))

    const rows = db.all<ModelPricingRow>(
      sql.raw(`SELECT * FROM model_pricing WHERE id = '${escSql(id)}'`),
    )

    if (rows.length === 0) {
      return { success: false, error: "Not found" }
    }

    return { success: true, updated: rows[0] }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) }
  }
}

// ─── deletePricing ───

export async function deletePricing(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    db.run(
      sql.raw(`DELETE FROM model_pricing WHERE id = '${escSql(id)}'`),
    )
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) }
  }
}

// ─── createManualPricing ───

export async function createManualPricing(
  copilotModelName: string,
  promptPrice: string,
  completionPrice: string,
  cacheReadPrice?: string,
): Promise<
  | { success: true; created: ModelPricingRow }
  | { success: false; error: string }
> {
  try {
    const id = nanoid()
    const ts = now()

    const query = `
      INSERT INTO model_pricing (id, copilot_model_name, openrouter_model_id, display_name, prompt_price, completion_price, cache_read_price, source, last_synced_at, created_at, updated_at)
      VALUES (
        '${escSql(id)}',
        '${escSql(copilotModelName)}',
        NULL,
        NULL,
        '${escSql(promptPrice)}',
        '${escSql(completionPrice)}',
        ${cacheReadPrice ? `'${escSql(cacheReadPrice)}'` : "NULL"},
        'manual',
        NULL,
        ${ts},
        ${ts}
      )
    `
    db.run(sql.raw(query))

    const rows = db.all<ModelPricingRow>(
      sql.raw(`SELECT * FROM model_pricing WHERE id = '${escSql(id)}'`),
    )

    return { success: true, created: rows[0] }
  } catch (err: any) {
    return { success: false, error: err.message ?? String(err) }
  }
}

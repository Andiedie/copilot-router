import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { config } from "../config"
import * as schema from "./schema"

mkdirSync(dirname(config.dbPath), { recursive: true })

const sqlite = new Database(config.dbPath)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA synchronous = NORMAL")

export const db = drizzle(sqlite, { schema })

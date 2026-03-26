import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { mkdirSync } from "node:fs"
import { config } from "../config"
import * as schema from "./schema"

mkdirSync("data", { recursive: true })

const sqlite = new Database(config.dbPath)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA synchronous = NORMAL")

export const db = drizzle(sqlite, { schema })

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { mkdirSync } from "node:fs"
import { config } from "../config"

mkdirSync("data", { recursive: true })

const sqlite = new Database(config.dbPath)
sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA synchronous = NORMAL")

const db = drizzle(sqlite)
migrate(db, { migrationsFolder: "./drizzle" })

console.log("Migration complete")
sqlite.close()

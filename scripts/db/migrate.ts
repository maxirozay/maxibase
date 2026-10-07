import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { existsSync } from 'node:fs'

// NUXT_DB from the project's .env, a variable already set in the environment wins
if (existsSync('.env')) process.loadEnvFile()

const db = drizzle(process.env.NUXT_DB!)
migrate(db, { migrationsFolder: './server/database/migrations' })

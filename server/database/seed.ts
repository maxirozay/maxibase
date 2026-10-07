import { drizzle } from 'drizzle-orm/node-postgres'
import { reset } from 'drizzle-seed'
import { existsSync } from 'node:fs'
import * as schema from './schema'

// NUXT_DB from the project's .env, a variable already set in the environment wins
if (existsSync('.env')) process.loadEnvFile()

async function seed() {
  const db = drizzle(process.env.NUXT_DB!)
  await reset(db, schema)
}

seed()

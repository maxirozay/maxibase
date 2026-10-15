import { drizzle } from 'drizzle-orm/node-postgres'
import { reset } from 'drizzle-seed'
import { existsSync } from 'node:fs'
import * as schema from './schema'

// NUXT_DB from the project's .env, a variable already set in the environment wins
if (existsSync('.env')) process.loadEnvFile()

async function seed() {
  const db = drizzle(process.env.NUXT_DB!)
  await reset(db, schema)

  // a demo shop on http://localhost:3000, add an organization per domain for the others
  const [shop] = await db
    .insert(schema.organizations)
    .values({ name: 'Demo shop', slug: 'demo', domain: 'localhost', currency: 'chf' })
    .returning()
  await db.insert(schema.products).values([
    { organizationId: shop!.id, name: 'T-shirt', description: 'Organic cotton', price: 2500 },
    { organizationId: shop!.id, name: 'Mug', description: 'Ceramic, 330 ml', price: 1500 },
    { organizationId: shop!.id, name: 'Sticker', price: 300 },
  ])
}

seed()

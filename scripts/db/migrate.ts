import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'

const db = drizzle(process.env.NUXT_DB!)
migrate(db, { migrationsFolder: './server/database/migrations' })

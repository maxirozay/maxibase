import { drizzle } from 'drizzle-orm/node-postgres'
import { relations } from '#database/relations'
import { authRelations } from '../relations'

// defineRelations gives every table an entry, empty ones included: only the project's tables
// with relations override the layer's, so an empty entry never erases them
const own = Object.fromEntries(
  Object.entries(relations).filter(([, table]) => Object.keys(table.relations).length),
)

export const db = drizzle(useRuntimeConfig().db, {
  relations: { ...relations, ...authRelations, ...own } as typeof relations & typeof authRelations,
})

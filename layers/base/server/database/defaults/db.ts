import { drizzle } from 'drizzle-orm/node-postgres'
import { relations } from '#database/relations'
import { authRelations } from '../relations'

export const db = drizzle(useRuntimeConfig().db, { relations: { ...relations, ...authRelations } })

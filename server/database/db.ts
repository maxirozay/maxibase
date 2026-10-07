import { drizzle } from 'drizzle-orm/node-postgres'
import { authRelations } from 'maxibase/layers/base/server/database/relations'
import { relations } from './relations'

export const db = drizzle(useRuntimeConfig().db, { relations: { ...relations, ...authRelations } })

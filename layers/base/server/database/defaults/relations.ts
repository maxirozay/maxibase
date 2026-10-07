import * as schema from '#server/database/schema'
import { defineRelationsPart } from 'drizzle-orm'

// No relations of the project's own, every table is still queryable with db.query
export const relations = defineRelationsPart(schema)

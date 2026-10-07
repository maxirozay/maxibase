import * as schema from '#server/database/schema'
import { defineRelationsPart } from 'drizzle-orm'

// Built from the project schema, so they also apply to a table the project overrides.
// Spread after the project's relations, so they replace any the project defines on these tables.
export const authRelations = defineRelationsPart(schema, (r) => ({
  auth: {
    refreshTokens: r.many.refreshTokens({
      from: r.auth.id,
      to: r.refreshTokens.userId,
    }),
    credentials: r.many.credentials({
      from: r.auth.id,
      to: r.credentials.userId,
    }),
  },
  refreshTokens: {
    auth: r.one.auth({
      from: r.refreshTokens.userId,
      to: r.auth.id,
    }),
  },
  credentials: {
    auth: r.one.auth({
      from: r.credentials.userId,
      to: r.auth.id,
    }),
  },
  logs: {
    auth: r.one.auth({
      from: r.logs.userId,
      to: r.auth.id,
    }),
  },
}))

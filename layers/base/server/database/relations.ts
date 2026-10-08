import * as schema from '#server/database/schema'
import { defineRelationsPart } from 'drizzle-orm'

// Built from the project schema, so they also apply to a table the project overrides.
// A project entry for one of these tables replaces the layer's, see defaults/db.ts.
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

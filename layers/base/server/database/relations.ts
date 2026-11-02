import * as schema from '#server/database/schema'
import { defineRelationsPart } from 'drizzle-orm'

// Built from the project schema, so they also apply to a table the project overrides.
// A project entry for one of these tables replaces the layer's, see defaults/db.ts.
export const authRelations = defineRelationsPart(schema, (r) => ({
  authUsers: {
    refreshTokens: r.many.authRefreshTokens({
      from: r.authUsers.id,
      to: r.authRefreshTokens.userId,
    }),
    credentials: r.many.authCredentials({
      from: r.authUsers.id,
      to: r.authCredentials.userId,
    }),
    recoveryCodes: r.many.authRecoveryCodes({
      from: r.authUsers.id,
      to: r.authRecoveryCodes.userId,
    }),
  },
  authRefreshTokens: {
    user: r.one.authUsers({
      from: r.authRefreshTokens.userId,
      to: r.authUsers.id,
    }),
  },
  authCredentials: {
    user: r.one.authUsers({
      from: r.authCredentials.userId,
      to: r.authUsers.id,
    }),
  },
  authRecoveryCodes: {
    user: r.one.authUsers({
      from: r.authRecoveryCodes.userId,
      to: r.authUsers.id,
    }),
  },
  authLogs: {
    user: r.one.authUsers({
      from: r.authLogs.userId,
      to: r.authUsers.id,
    }),
  },
}))

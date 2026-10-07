import * as schema from './schema'
import { defineRelations } from 'drizzle-orm'

// The layer's tables get their relations from the package, see db.ts
export const relations = defineRelations(schema, (r) => ({
  organizations: {
    members: r.many.organizationMembers({
      from: r.organizations.id,
      to: r.organizationMembers.organizationId,
    }),
  },
}))

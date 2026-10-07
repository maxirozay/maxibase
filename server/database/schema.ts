import { snakeCase, text, uuid, primaryKey, pgEnum } from 'drizzle-orm/pg-core'
import { auth } from 'maxibase/layers/base/server/database/schema'

// The layer's tables, updated with the package. To customise one, copy it here: an export
// declared in this file takes precedence over the one with the same name from the package.
export * from 'maxibase/layers/base/server/database/schema'

export const organizations = snakeCase.table('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().unique().notNull(),
})

export const memberRoleEnum = pgEnum('member_role', ['admin', 'member'])
export const organizationMembers = snakeCase.table(
  'organization_members',
  {
    userId: uuid()
      .notNull()
      .references(() => auth.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: memberRoleEnum().notNull().default('member'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
)

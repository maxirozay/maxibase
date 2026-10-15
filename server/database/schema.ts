import {
  snakeCase,
  text,
  uuid,
  primaryKey,
  pgEnum,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { auth } from 'maxibase/layers/base/server/database/schema'

// The layer's tables, updated with the package. To customise one, copy it here: an export
// declared in this file takes precedence over the one with the same name from the package.
export * from 'maxibase/layers/base/server/database/schema'

export const organizations = snakeCase.table('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().unique().notNull(),
  domain: text().unique(), // host without port, picks the shop shown on that site
  currency: text().notNull().default('chf'),
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

export const products = snakeCase.table(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    image: text(),
    price: integer().notNull(), // in the currency's smallest unit, e.g. cents
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('products_organization_idx').on(table.organizationId)],
)

export type OrderItem = { productId: string; name: string; price: number; quantity: number }

export const orderStatusEnum = pgEnum('order_status', ['pending', 'paid'])
export const orders = snakeCase.table(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: orderStatusEnum().notNull().default('pending'),
    items: jsonb().notNull().$type<OrderItem[]>(), // snapshot of the products at checkout
    total: integer().notNull(),
    currency: text().notNull(),
    email: text(),
    stripeSessionId: text().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('orders_organization_idx').on(table.organizationId)],
)

import type { WebAuthnCredential } from '#auth-utils'
import {
  snakeCase,
  text,
  integer,
  timestamp,
  uuid,
  boolean,
  primaryKey,
  pgEnum,
  jsonb,
  bigint,
  index,
} from 'drizzle-orm/pg-core'

export const authSchema = snakeCase.schema('auth')

export const appRoleEnum = pgEnum('app_role', ['admin', 'user'])
export const auth = authSchema.table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().unique(),
  password: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  totp: text(),
  role: appRoleEnum().notNull().default('user'),
})

export const refreshTokens = authSchema.table('refresh_tokens', {
  token: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => auth.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const credentials = authSchema.table(
  'credentials',
  {
    userId: uuid()
      .notNull()
      .references(() => auth.id, { onDelete: 'cascade' }),
    id: text().unique().notNull(),
    name: text().notNull(),
    publicKey: text().notNull(),
    counter: integer().notNull(),
    backedUp: boolean().notNull(),
    transports: text().array().notNull().$type<WebAuthnCredential['transports']>(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
)

export const logs = authSchema.table(
  'logs',
  {
    id: bigint({ mode: 'number' }).generatedByDefaultAsIdentity().primaryKey(),
    userId: uuid().references(() => auth.id, { onDelete: 'cascade' }),
    type: text().notNull().default('info'),
    origin: text(),
    summary: text(),
    data: jsonb(),
    time: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ipAddress: text(),
    userAgent: text(),
  },
  (table) => [index('logs_time_idx').on(table.time)],
)

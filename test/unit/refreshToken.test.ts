import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetTestState, setConfig } from '../setup'
import { refreshTokens } from '#server/database/schema'
import {
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  hashRefreshToken,
} from '#server-utils/auth'

// Conditions as plain data, so the in-memory db below can apply them
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}))

type Row = { token: string; userId: string; createdAt: Date }
type Condition = { column: unknown; value: unknown }

let rows: Row[] = []
const cookies = new Map<string, string>()
const event = {} as any

const matches =
  ({ column, value }: Condition) =>
  (row: Row) =>
    column === refreshTokens.token && row.token === value

const db = {
  query: {
    refreshTokens: {
      findFirst: async ({ where }: { where: { token: string } }) =>
        rows.find((row) => row.token === where.token),
    },
    auth: { findFirst: async () => ({ id: 'user-1' }) },
  },
  insert: () => ({
    values: async (value: Omit<Row, 'createdAt'>) =>
      void rows.push({ ...value, createdAt: new Date() }),
  }),
  delete: () => ({
    where: async (condition: Condition) => {
      rows = rows.filter((row) => !matches(condition)(row))
    },
  }),
}

beforeEach(() => {
  resetTestState()
  setConfig({ refreshToken: { maxAge: 3600 } })
  rows = []
  cookies.clear()
  vi.stubGlobal('db', db)
  vi.stubGlobal('getCookie', (_event: unknown, name: string) => cookies.get(name))
  vi.stubGlobal('setCookie', (_event: unknown, name: string, value: string) =>
    cookies.set(name, value),
  )
  vi.stubGlobal('deleteCookie', (_event: unknown, name: string) => cookies.delete(name))
})

afterEach(() => vi.unstubAllGlobals())

describe('refresh tokens', () => {
  it('stores only the hash of a new token', async () => {
    const token = await createRefreshToken('user-1', event)
    expect(cookies.get('refresh_token')).toBe(token)
    expect(rows.map((row) => row.token)).toEqual([hashRefreshToken(token)])
    await expect(verifyRefreshToken(event)).resolves.toMatchObject({ user: { id: 'user-1' } })
  })

  it('rejects a stored hash sent back as the cookie', async () => {
    const token = await createRefreshToken('user-1', event)
    cookies.set('refresh_token', hashRefreshToken(token))
    await expect(verifyRefreshToken(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(cookies.has('refresh_token')).toBe(false)
  })

  it('rejects a token stored in plain text before hashing', async () => {
    const token = 'a'.repeat(43)
    rows.push({ token, userId: 'user-1', createdAt: new Date() })
    cookies.set('refresh_token', token)
    await expect(verifyRefreshToken(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('revokes the token from the cookie', async () => {
    const token = await createRefreshToken('user-1', event)
    await revokeRefreshToken(token)
    expect(rows).toEqual([])
  })
})

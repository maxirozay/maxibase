import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetTestState, setConfig } from '../setup'
import { authRefreshTokens } from '#server/database/schema'
import {
  createRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  hashRefreshToken,
  cleanRefreshTokens,
} from '#server-utils/auth'

// Conditions as plain data, so the in-memory db below can apply them
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  lte: (column: unknown, value: unknown) => ({ column, value, lte: true }),
}))

type Row = { token: string; userId: string; createdAt: Date }
type Condition = { column: unknown; value: any; lte?: boolean }

let rows: Row[] = []
const cookies = new Map<string, string>()
const event = {} as any

const matches =
  ({ column, value, lte }: Condition) =>
  (row: Row) =>
    lte
      ? column === authRefreshTokens.createdAt && row.createdAt <= value
      : column === authRefreshTokens.token && row.token === value

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000)

const db = {
  query: {
    authRefreshTokens: {
      findFirst: async ({ where }: { where: { token: string } }) =>
        rows.find((row) => row.token === where.token),
    },
    authUsers: { findFirst: async () => ({ id: 'user-1' }) },
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
  // updateLastActive, not under test here
  update: () => ({ set: () => ({ where: async () => {} }) }),
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

  it('rejects an expired token and deletes it', async () => {
    rows.push({ token: hashRefreshToken('old'), userId: 'user-1', createdAt: hoursAgo(2) })
    cookies.set('refresh_token', 'old')
    await expect(verifyRefreshToken(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(rows).toEqual([])
    expect(cookies.has('refresh_token')).toBe(false)
  })

  // An expired token nobody sends again would otherwise stay in the table forever
  it('cleans only the expired tokens', async () => {
    rows.push(
      { token: 'expired', userId: 'user-1', createdAt: hoursAgo(2) },
      { token: 'valid', userId: 'user-1', createdAt: hoursAgo(0.5) },
    )
    await cleanRefreshTokens()
    expect(rows.map((row) => row.token)).toEqual(['valid'])
  })
})

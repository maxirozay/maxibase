import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestState, setConfig, storage } from '../setup'
import { recoveryCodes } from '#server/database/schema'
import { passwordSchema } from '#server-utils/schemas'
import {
  generateRecoveryCodes,
  consumeRecoveryCode,
  countRecoveryCodes,
} from '#server-utils/recoveryCodes'
import verify from '#server-api/auth/recovery/verify.post'

// Conditions as plain data, so the in-memory db below can apply them
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (column: unknown, value: unknown) => [{ column, value }],
  and: (...conditions: Condition[][]) => conditions.flat(),
}))

type Row = { userId: string; code: string }
type Condition = { column: unknown; value: unknown }

let rows: Row[] = []

const matches = (conditions: Condition[]) => (row: Row) =>
  conditions.every(({ column, value }) =>
    column === recoveryCodes.userId ? row.userId === value : row.code === value,
  )

function remove(conditions: Condition[]) {
  const removed = rows.filter(matches(conditions))
  rows = rows.filter((row) => !matches(conditions)(row))
  return removed
}

const db = {
  select: () => ({
    from: () => ({ where: async (conditions: Condition[]) => rows.filter(matches(conditions)) }),
  }),
  insert: () => ({ values: async (values: Row[]) => void rows.push(...values) }),
  delete: () => ({
    where: (conditions: Condition[]) => {
      const removed = remove(conditions)
      return Object.assign(Promise.resolve(), { returning: async () => removed })
    },
  }),
  transaction: async (callback: (tx: typeof db) => Promise<void>) => callback(db),
  $count: async (_table: unknown, conditions: Condition[]) =>
    rows.filter(matches(conditions)).length,
}

const user = { id: 'user-1', email: 'user@example.com', password: 'hashed:correct horse' }
const setSession = vi.fn(async () => ({}))
const sendEmailTemplate = vi.fn(async () => {})

beforeEach(() => {
  resetTestState()
  setConfig({ public: { password: { min: 8, max: 64 } } })
  rows = []
  setSession.mockClear()
  sendEmailTemplate.mockClear()
  vi.stubGlobal('db', db)
  vi.stubGlobal('passwordSchema', passwordSchema)
  vi.stubGlobal('getAuth', async (_event: unknown, email: string) => {
    if (email === user.email) return user
    throw Object.assign(new Error('User not found'), { statusCode: 404 })
  })
  vi.stubGlobal('enforceRateLimit', async () => {})
  vi.stubGlobal('setSession', setSession)
  vi.stubGlobal('sendEmailTemplate', sendEmailTemplate)
  vi.stubGlobal('consumeRecoveryCode', consumeRecoveryCode)
})

describe('generateRecoveryCodes', () => {
  it('returns 10 codes and stores only their hashes', async () => {
    const codes = await generateRecoveryCodes('user-1')
    expect(codes).toHaveLength(10)
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/)
    expect(rows.map((row) => row.code)).not.toContain(codes[0])
    expect(rows.map((row) => row.code)).not.toContain(codes[0]!.replace('-', ''))
  })

  it('replaces the previous codes', async () => {
    const [old] = await generateRecoveryCodes('user-1')
    await generateRecoveryCodes('user-1')
    expect(await countRecoveryCodes('user-1')).toBe(10)
    expect(await consumeRecoveryCode('user-1', old!)).toBeNull()
  })
})

describe('consumeRecoveryCode', () => {
  it('accepts a code once, whatever its case, spacing or dash', async () => {
    const [code] = await generateRecoveryCodes('user-1')
    const typed = ` ${code!.replace('-', ' ').toUpperCase()} `
    expect(await consumeRecoveryCode('user-1', typed)).toBe(9)
    expect(await consumeRecoveryCode('user-1', code!)).toBeNull()
  })

  it("refuses another user's code", async () => {
    const [code] = await generateRecoveryCodes('user-2')
    expect(await consumeRecoveryCode('user-1', code!)).toBeNull()
    expect(await countRecoveryCodes('user-2')).toBe(10)
  })

  it('lets only one of two concurrent uses through', async () => {
    const [code] = await generateRecoveryCodes('user-1')
    const results = await Promise.all([
      consumeRecoveryCode('user-1', code!),
      consumeRecoveryCode('user-1', code!),
    ])
    expect(results.filter((result) => result !== null)).toHaveLength(1)
  })
})

describe('POST /api/auth/recovery/verify', () => {
  it('signs in with the password and a code, and warns by email', async () => {
    const [code] = await generateRecoveryCodes('user-1')
    await verify({ body: { email: user.email, password: 'correct horse', code } } as any)
    expect(setSession).toHaveBeenCalledWith(expect.anything(), user)
    expect(sendEmailTemplate).toHaveBeenCalledWith(
      'recoveryCodeUsed',
      'en',
      { remaining: 9 },
      user.email,
    )
  })

  // The code replaces the second factor only: a wrong first factor must not spend it
  it('refuses a wrong password without consuming the code', async () => {
    const [code] = await generateRecoveryCodes('user-1')
    await expect(
      verify({ body: { email: user.email, password: 'wrong password', code } } as any),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid password.' })
    expect(await countRecoveryCodes('user-1')).toBe(10)
    expect(setSession).not.toHaveBeenCalled()
  })

  it('removes the email code once the recovery code passes', async () => {
    const [code] = await generateRecoveryCodes('user-1')
    storage.set(`auth:${user.email}`, { otp: 'hashed:123456', attempts: 0, sentAt: Date.now() })
    await verify({ body: { email: user.email, otp: '123456', code } } as any)
    expect(storage.has(`auth:${user.email}`)).toBe(false)
    expect(setSession).toHaveBeenCalledOnce()
  })

  it('refuses a wrong code', async () => {
    await generateRecoveryCodes('user-1')
    await expect(
      verify({
        body: { email: user.email, password: 'correct horse', code: '00000-00000' },
      } as any),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid recovery code.' })
    expect(setSession).not.toHaveBeenCalled()
  })
})

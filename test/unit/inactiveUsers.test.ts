import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logSpy, resetTestState, setConfig } from '../setup'
import { daysToMilliseconds } from '#server-utils/time'
import { cleanInactiveUsers } from '#server-utils/auth'

// Conditions as plain data, so the ids deleted or warned can be read back
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
}))

type User = { id: string; email: string; locale: string | null; lastActiveOn: Date }

let pastLimit: string[] = []
let toWarn: User[] = []
let deleted: string[] = []
let warned: string[] = []

const db = {
  // The deletion selects only the id, the warning the email too
  select: vi.fn((fields: object) => ({
    from: () => ({
      where: async () => ('email' in fields ? toWarn : pastLimit.map((id) => ({ id }))),
    }),
  })),
  delete: vi.fn(() => ({
    where: ([{ values }]: [{ values: string[] }]) => ({
      returning: async () => {
        deleted.push(...values)
        return values.map((id) => ({ id }))
      },
    }),
  })),
  update: () => ({
    set: () => ({ where: async ({ value }: { value: string }) => void warned.push(value) }),
  }),
}

const sendEmailTemplate = vi.fn(
  async (_id: string, _locale: string, _params: object, to: string) => {
    if (to.startsWith('fail')) throw new Error('SMTP down')
  },
)

const deleteUserFiles = vi.fn(async (id: string) => {
  if (id.startsWith('fail')) throw new Error('S3 down')
})

const user = (id: string, locale: string | null = 'en'): User => ({
  id,
  email: `${id}@example.com`,
  locale,
  lastActiveOn: new Date('2026-01-01'),
})

beforeEach(() => {
  resetTestState()
  setConfig({ inactiveUsers: { retentionDays: 730, warningDays: 30 } })
  pastLimit = []
  toWarn = []
  deleted = []
  warned = []
  db.select.mockClear()
  db.delete.mockClear()
  sendEmailTemplate.mockClear()
  deleteUserFiles.mockClear()
  vi.stubGlobal('db', db)
  vi.stubGlobal('sendEmailTemplate', sendEmailTemplate)
  vi.stubGlobal('deleteUserFiles', deleteUserFiles)
  vi.stubGlobal('daysToMilliseconds', daysToMilliseconds)
})

describe('cleanInactiveUsers', () => {
  it('deletes the files of users past the limit, then the users', async () => {
    pastLimit = ['a', 'b']
    await cleanInactiveUsers()
    expect(deleteUserFiles.mock.calls).toEqual([['a'], ['b']])
    expect(deleted).toEqual(['a', 'b'])
    expect(logSpy).toHaveBeenCalledWith(
      'Deleted 2 users inactive for 730 days',
      undefined,
      'clean task',
    )
  })

  // Deleting the row first would orphan the files, with nothing left to retry them.
  it('keeps a user whose files could not be deleted', async () => {
    pastLimit = ['fail', 'ok']
    await expect(cleanInactiveUsers()).rejects.toThrow(
      'Inactive users: files of 1 users could not be deleted',
    )
    expect(deleted).toEqual(['ok'])
  })

  it.each([0, -1, 1.5, true, '30', null, Infinity])(
    'refuses to run with retentionDays %j',
    async (retentionDays) => {
      setConfig({ inactiveUsers: { retentionDays, warningDays: 30 } })
      await expect(cleanInactiveUsers()).rejects.toThrow('Inactive users: invalid retentionDays')
      expect(db.select).not.toHaveBeenCalled()
    },
  )

  it('deletes nothing when no user is past the limit', async () => {
    await cleanInactiveUsers()
    expect(db.delete).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  // A user warned tonight must not be deleted in the same run.
  it('deletes before warning', async () => {
    pastLimit = ['gone']
    await cleanInactiveUsers()
    expect(db.delete.mock.invocationCallOrder[0]).toBeLessThan(
      db.select.mock.invocationCallOrder[1]!,
    )
  })

  // Deleted on the first night after lastActiveOn + retentionDays.
  it('announces the deletion date in the user locale', async () => {
    toWarn = [user('fr', 'fr'), user('none', null)]
    await cleanInactiveUsers()
    expect(sendEmailTemplate).toHaveBeenCalledWith(
      'inactiveDeletion',
      'fr',
      { date: '2 janvier 2028' },
      'fr@example.com',
    )
    expect(sendEmailTemplate).toHaveBeenCalledWith(
      'inactiveDeletion',
      'en',
      { date: 'January 2, 2028' },
      'none@example.com',
    )
    expect(warned).toEqual(['fr', 'none'])
  })

  it('does not warn when warningDays is 0', async () => {
    setConfig({ inactiveUsers: { retentionDays: 730, warningDays: 0 } })
    toWarn = [user('a')]
    await cleanInactiveUsers()
    expect(db.select).toHaveBeenCalledOnce()
    expect(sendEmailTemplate).not.toHaveBeenCalled()
  })

  // Not marked as warned, so the next night retries it.
  it('reports failed warnings after sending the others', async () => {
    toWarn = [user('fail'), user('ok')]
    await expect(cleanInactiveUsers()).rejects.toThrow('Inactive users: 1 warnings failed to send')
    expect(warned).toEqual(['ok'])
    expect(logSpy).toHaveBeenCalledWith(
      'Warned 1 inactive users of their deletion',
      undefined,
      'clean task',
    )
  })
})

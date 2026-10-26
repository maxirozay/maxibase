import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logSpy, resetTestState, setConfig } from '../setup'
import { daysToMilliseconds } from '#server-utils/time'
import { cleanInactiveUsers } from '#server-utils/auth'

// Conditions as plain data, so the warned user's id can be read back
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}))

type User = { id: string; email: string; locale: string | null; lastActiveOn: Date }

let deleted: { id: string }[] = []
let inactive: User[] = []
let warned: string[] = []

const db = {
  delete: vi.fn(() => ({ where: () => ({ returning: async () => deleted }) })),
  select: vi.fn(() => ({ from: () => ({ where: async () => inactive }) })),
  update: () => ({
    set: () => ({ where: async ({ value }: { value: string }) => void warned.push(value) }),
  }),
}

const sendEmailTemplate = vi.fn(
  async (_id: string, _locale: string, _params: object, to: string) => {
    if (to.startsWith('fail')) throw new Error('SMTP down')
  },
)

const user = (id: string, locale: string | null = 'en'): User => ({
  id,
  email: `${id}@example.com`,
  locale,
  lastActiveOn: new Date('2026-01-01'),
})

beforeEach(() => {
  resetTestState()
  setConfig({ inactiveUsers: { retentionDays: 730, warningDays: 30 } })
  deleted = []
  inactive = []
  warned = []
  db.delete.mockClear()
  db.select.mockClear()
  sendEmailTemplate.mockClear()
  vi.stubGlobal('db', db)
  vi.stubGlobal('sendEmailTemplate', sendEmailTemplate)
  vi.stubGlobal('daysToMilliseconds', daysToMilliseconds)
})

describe('cleanInactiveUsers', () => {
  // A user warned tonight must not be deleted in the same run.
  it('deletes before warning', async () => {
    deleted = [{ id: 'gone' }]
    await cleanInactiveUsers()
    expect(db.delete.mock.invocationCallOrder[0]).toBeLessThan(
      db.select.mock.invocationCallOrder[0]!,
    )
    expect(logSpy).toHaveBeenCalledWith(
      'Deleted 1 users inactive for 730 days',
      undefined,
      'clean task',
    )
  })

  // Deleted on the first night after lastActiveOn + retentionDays.
  it('announces the deletion date in the user locale', async () => {
    inactive = [user('fr', 'fr'), user('none', null)]
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
    await cleanInactiveUsers()
    expect(db.delete).toHaveBeenCalledOnce()
    expect(db.select).not.toHaveBeenCalled()
  })

  // Not marked as warned, so the next night retries it.
  it('reports failed warnings after sending the others', async () => {
    inactive = [user('fail'), user('ok')]
    await expect(cleanInactiveUsers()).rejects.toThrow(
      '1 of 2 inactive user warnings failed to send',
    )
    expect(warned).toEqual(['ok'])
    expect(logSpy).toHaveBeenCalledWith(
      'Warned 1 inactive users of their deletion',
      undefined,
      'clean task',
    )
  })
})

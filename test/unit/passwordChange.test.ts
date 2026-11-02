import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logSpy, resetTestState, setConfig } from '../setup'
import { passwordSchema } from '#server-utils/schemas'
import handler from '#server-api/auth/index.post'

const password = 'correct horse battery'
let stored: string | undefined
let user: { id: string; email?: string }

const sendEmailTemplate = vi.fn(async () => {})

beforeEach(() => {
  resetTestState()
  setConfig({ public: { password: { min: 16, max: 64 } } })
  stored = undefined
  user = { id: 'user-1', email: 'user@example.com' }
  sendEmailTemplate.mockReset()
  vi.stubGlobal('passwordSchema', passwordSchema)
  vi.stubGlobal('requireRecentAuth', async () => ({ user }))
  vi.stubGlobal('sendEmailTemplate', sendEmailTemplate)
  vi.stubGlobal('db', {
    update: () => ({
      set: ({ password }: { password: string }) => ({
        where: async () => void (stored = password),
      }),
    }),
  })
})

afterEach(() => vi.unstubAllGlobals())

const change = (body: object) => (handler as any)({ body: { password, ...body } })

describe('POST /api/auth', () => {
  it('stores the hash, logs it and warns by email', async () => {
    await change({ locale: 'fr' })
    expect(stored).toBe(`hashed:${password}`)
    expect(logSpy).toHaveBeenCalledWith(
      'Password changed',
      undefined,
      undefined,
      'security',
      expect.anything(),
    )
    expect(sendEmailTemplate).toHaveBeenCalledWith('passwordChanged', 'fr', {}, user.email)
  })

  it('keeps the new password when the email fails', async () => {
    sendEmailTemplate.mockRejectedValue(new Error('SMTP down'))
    await expect(change({})).resolves.toBeUndefined()
    expect(stored).toBe(`hashed:${password}`)
  })

  it('sends no email to an anonymous user', async () => {
    user = { id: 'user-1' }
    await change({})
    expect(stored).toBe(`hashed:${password}`)
    expect(sendEmailTemplate).not.toHaveBeenCalled()
  })
})

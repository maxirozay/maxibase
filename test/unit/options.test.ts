import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestState } from '../setup'
import options from '#server-api/auth/options.post'

const event = { body: { email: 'user@example.com' } } as any

beforeEach(() => resetTestState())

describe('POST /api/auth/options', () => {
  // the sign-in form depends on it: a table it reads must not be one a missed migration lacks
  it('reads only the user and their passkeys', async () => {
    vi.stubGlobal('getAuth', async () => ({ id: 'user-1', password: 'hash', credentials: [] }))
    expect(await options(event)).toEqual({
      hasOTP: true,
      hasPassword: true,
      hasTOTP: false,
      hasPasskey: false,
    })
  })

  it('answers with the defaults for an unknown email', async () => {
    vi.stubGlobal('getAuth', async () => {
      throw Object.assign(new Error('User not found'), { statusCode: 404 })
    })
    expect(await options(event)).toMatchObject({ hasPassword: false, hasTOTP: false })
  })

  // e.g. a table missing because the migration did not run: defaults would hide it
  // and send users with a password to the email code instead
  it('lets a database error through', async () => {
    vi.stubGlobal('getAuth', async () => {
      throw new Error('relation "auth.recovery_codes" does not exist')
    })
    await expect(options(event)).rejects.toThrow('does not exist')
  })
})

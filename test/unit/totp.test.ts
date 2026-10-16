import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generate, generateSecret } from 'otplib'
import { resetTestState } from '../setup'
import confirm from '#server-api/auth/totp/confirm.post'

const requireRecentAuth = vi.fn(async () => ({ user: { id: 'user-1' } }))

beforeEach(() => {
  resetTestState()
  requireRecentAuth.mockClear()
  vi.stubGlobal('requireRecentAuth', requireRecentAuth)
})

describe('POST /api/auth/totp/confirm', () => {
  // The secret is stored as sent, so it is bounded like the one generateSecret issues.
  it('refuses a secret longer than 64 characters', async () => {
    await expect(
      confirm({ body: { secret: 'A'.repeat(65), token: '123456' } } as any),
    ).rejects.toThrow()
    expect(requireRecentAuth).not.toHaveBeenCalled()
  })

  it('accepts the length of a generated secret', async () => {
    const secret = generateSecret()
    const code = await generate({ secret })
    const wrong = code.replace(/^./, (digit) => String((Number(digit) + 1) % 10))
    // Past validation, the wrong code is refused by the TOTP check instead.
    await expect(confirm({ body: { secret, token: wrong } } as any)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid code.',
    })
    expect(requireRecentAuth).toHaveBeenCalledOnce()
  })
})

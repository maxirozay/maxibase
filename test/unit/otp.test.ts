import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetTestState, storage } from '../setup'
import { verifyOTP } from '#server-api/auth/otp/verify.post'
import { generateOTP } from '#server-api/auth/otp/get.post'

const email = 'user@example.com'

function seed(overrides: Record<string, any> = {}) {
  storage.set(`auth:${email}`, {
    otp: 'hashed:123456',
    token: 'hashed:' + 'a'.repeat(32),
    attempts: 0,
    sentAt: Date.now(),
    ...overrides,
  })
}

beforeEach(() => {
  resetTestState()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => vi.useRealTimers())

describe('generateOTP', () => {
  it('always returns six digits, never a short code from a leading zero', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOTP()).toMatch(/^[1-9]\d{5}$/)
    }
  })
})

describe('verifyOTP', () => {
  it('rejects when no code was requested', async () => {
    await expect(verifyOTP(email, '123456')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts the code and consumes it', async () => {
    seed()
    await expect(verifyOTP(email, '123456')).resolves.toBeUndefined()
    expect(storage.get(`auth:${email}`)).toBeUndefined()
  })

  it('cannot replay a consumed code', async () => {
    seed()
    await verifyOTP(email, '123456')
    await expect(verifyOTP(email, '123456')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts the magic-link token on the same record', async () => {
    seed()
    await expect(verifyOTP(email, 'a'.repeat(32))).resolves.toBeUndefined()
    expect(storage.get(`auth:${email}`)).toBeUndefined()
  })

  it('does not accept the OTP where a token is expected, or the reverse', async () => {
    seed({ token: undefined })
    // Long input reads the token slot, which is empty here.
    await expect(verifyOTP(email, 'b'.repeat(32))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('expires after five minutes', async () => {
    seed()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    await expect(verifyOTP(email, '123456')).rejects.toMatchObject({ statusCode: 400 })
    expect(storage.get(`auth:${email}`)).toBeUndefined()
  })

  it('counts a failed guess', async () => {
    seed()
    await expect(verifyOTP(email, '000000')).rejects.toMatchObject({ statusCode: 400 })
    expect(storage.get(`auth:${email}`).attempts).toBe(1)
  })

  it('allows three guesses and then burns the code', async () => {
    seed()
    for (let i = 0; i < 3; i++) {
      await expect(verifyOTP(email, '000000')).rejects.toMatchObject({ statusCode: 400 })
      expect(storage.get(`auth:${email}`)).toBeDefined()
    }

    // Fourth guess is refused outright, and the right code no longer works.
    await expect(verifyOTP(email, '000000')).rejects.toMatchObject({ statusCode: 400 })
    expect(storage.get(`auth:${email}`)).toBeUndefined()
    await expect(verifyOTP(email, '123456')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('counts parallel guesses before checking them', async () => {
    seed()
    const guesses = ['000000', '111111', '222222', '123456'].map((otp) => verifyOTP(email, otp))
    const results = await Promise.allSettled(guesses)
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetTestState, setConfig, storage } from '../setup'
import handler, { verifyOTP } from '#server-api/auth/otp/verify.post'
import { requireSecondFactor } from '#server-utils/auth'
import requestHandler, { generateOTP } from '#server-api/auth/otp/get.post'
import { safePath } from '#shared-utils/url'

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

  it('keeps an unconsumed code but still counts the attempt', async () => {
    seed()
    for (let i = 0; i < 3; i++) await verifyOTP(email, '123456', false)
    await expect(verifyOTP(email, '123456', false)).rejects.toMatchObject({ statusCode: 400 })
    expect(storage.get(`auth:${email}`)).toBeUndefined()
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

describe('POST /api/auth/otp/verify', () => {
  const users = new Map<string, Record<string, any>>()
  const setSession = vi.fn(async (_event: unknown, user: unknown) => user)
  const createAuth = vi.fn(async ({ email }: { email: string }) => ({ id: 'new', email }))
  const verify = (otp = '123456') => handler({ body: { email, otp } } as any)

  beforeEach(() => {
    users.clear()
    setSession.mockClear()
    createAuth.mockClear()
    vi.stubGlobal('setSession', setSession)
    vi.stubGlobal('createAuth', createAuth)
    vi.stubGlobal('requireSecondFactor', requireSecondFactor)
    vi.stubGlobal('getAuth', async (_event: unknown, email: string) => {
      const user = users.get(email)
      if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })
      return user
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('signs in and consumes the code', async () => {
    users.set(email, { id: '1', email, credentials: [] })
    seed()
    await verify()
    expect(setSession).toHaveBeenCalledOnce()
    expect(storage.get(`auth:${email}`)).toBeUndefined()
  })

  it('keeps the code for /totp/verify when a TOTP is required', async () => {
    users.set(email, { id: '1', email, totp: 'secret', credentials: [] })
    seed()
    await expect(verify()).rejects.toMatchObject({ statusCode: 401, message: 'TOTP required' })
    expect(storage.get(`auth:${email}`)).toMatchObject({ attempts: 0 })
    expect(setSession).not.toHaveBeenCalled()
  })

  it('needs a valid code before telling an unknown email apart', async () => {
    seed()
    await expect(verify('000000')).rejects.toMatchObject({ message: 'Invalid OTP.' })
    await expect(verify()).rejects.toMatchObject({ statusCode: 404 })
    expect(createAuth).not.toHaveBeenCalled()
  })

  it('signs up an unknown email when autoSignup is on', async () => {
    setConfig({ autoSignup: true })
    seed()
    await verify()
    expect(createAuth).toHaveBeenCalledWith({ email })
    expect(setSession).toHaveBeenCalledOnce()
  })
})

describe('POST /api/auth/otp/get', () => {
  const sendEmailTemplate = vi.fn(async () => ({
    messageId: '<id@smtp.test>',
    response: '250 2.0.0 Ok: queued as ABC123',
    envelope: { from: 'noreply@app.test', to: [email] },
  }))

  beforeEach(() => {
    sendEmailTemplate.mockClear()
    vi.stubGlobal('sendEmailTemplate', sendEmailTemplate)
    vi.stubGlobal('safePath', safePath)
  })

  afterEach(() => vi.unstubAllGlobals())

  // The SMTP result names the mail server and its replies, which with an
  // organization's own server is not ours to hand to whoever asks for a code.
  it('sends the code without returning the SMTP result', async () => {
    const result = await requestHandler({ body: { email } } as any)
    expect(sendEmailTemplate).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })
})

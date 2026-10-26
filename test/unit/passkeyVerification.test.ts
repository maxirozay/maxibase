import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestState, setConfig } from '../setup'
import { passkeyUserVerification, requireUserVerification } from '#server-utils/auth'

beforeEach(() => resetTestState())

describe('passkey user verification', () => {
  it('accepts a touch-only security key without forceMfa', () => {
    setConfig({ forceMfa: false })
    expect(passkeyUserVerification()).toBe('preferred')
    expect(() => requireUserVerification(false)).not.toThrow()
  })

  // the passkey is the whole second factor, a touch alone is only one
  it('requires a PIN or biometrics under forceMfa', () => {
    setConfig({ forceMfa: true })
    expect(passkeyUserVerification()).toBe('required')
    expect(() => requireUserVerification(true)).not.toThrow()
    expect(() => requireUserVerification(false)).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    )
  })
})

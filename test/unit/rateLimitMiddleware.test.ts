import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestState, config } from '../setup'
import middleware from '../../layers/base/server/middleware/0.rateLimit'

const routes = {
  '/api/auth': { limit: 100, window: 60 },
  '/api/auth/otp/get': { limit: 5, window: 900 },
}

// The middleware reaches enforceRateLimit through Nitro's auto-imports, so the
// seam is the global, not the module.
const enforce = vi.fn(async () => {})

beforeEach(() => {
  resetTestState()
  enforce.mockClear()
  config.rateLimit.routes = routes
  ;(globalThis as any).enforceRateLimit = enforce
})

const run = (path: string) => (middleware as any)({ path })

describe('rate limit middleware', () => {
  it('ignores paths with no rule', async () => {
    await run('/api/files')
    expect(enforce).not.toHaveBeenCalled()
  })

  it('matches an exact path', async () => {
    await run('/api/auth')
    expect(enforce.mock.calls[0]?.[1]).toBe('/api/auth')
  })

  // A prefix match must not let the loose parent rule shadow the strict child one.
  it('prefers the longest matching prefix', async () => {
    await run('/api/auth/otp/get')
    expect(enforce.mock.calls[0]?.[1]).toBe('/api/auth/otp/get')
  })

  it('applies a parent rule to an unlisted child path', async () => {
    await run('/api/auth/webauthn/register')
    expect(enforce.mock.calls[0]?.[1]).toBe('/api/auth')
  })

  it('does not match a path that merely starts with the same characters', async () => {
    await run('/api/authenticate')
    expect(enforce).not.toHaveBeenCalled()
  })

  it('ignores the query string', async () => {
    await run('/api/auth/otp/get?x=1')
    expect(enforce.mock.calls[0]?.[1]).toBe('/api/auth/otp/get')
  })

  it('does nothing when rate limiting is disabled', async () => {
    config.rateLimit.enabled = false
    await run('/api/auth/otp/get')
    expect(enforce).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resetTestState, logSpy, session, config } from '../setup'
import { enforceRateLimit, rateLimitIP } from '#server-utils/rateLimit'

const rule = { limit: 3, window: 60 }
const event = { ip: '203.0.113.1' } as any

// The limiter keeps one module-level map, so every test needs its own route key.
let routeId = 0
const nextRoute = () => `/api/test/${routeId++}`

beforeEach(() => {
  resetTestState()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => vi.useRealTimers())

async function hit(route: string, times: number, ev: any = event) {
  for (let i = 0; i < times; i++) await enforceRateLimit(ev, route, rule)
}

describe('enforceRateLimit', () => {
  it('allows requests up to the limit', async () => {
    const route = nextRoute()
    await expect(hit(route, rule.limit)).resolves.toBeUndefined()
  })

  it('throws 429 on the request past the limit', async () => {
    const route = nextRoute()
    await hit(route, rule.limit)
    await expect(enforceRateLimit(event, route, rule)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('logs the first breach once, not on every later request', async () => {
    const route = nextRoute()
    await hit(route, rule.limit)
    await enforceRateLimit(event, route, rule).catch(() => {})
    await enforceRateLimit(event, route, rule).catch(() => {})
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0]?.[0]).toBe('Rate limit exceeded')
  })

  it('bans at limit x banMultiplier and keeps rejecting inside the window', async () => {
    const route = nextRoute()
    const attempts = rule.limit * config.rateLimit.banMultiplier
    for (let i = 0; i < attempts; i++) await enforceRateLimit(event, route, rule).catch(() => {})

    expect(logSpy.mock.calls.map((call) => call[0])).toContain('Rate limit ban')

    // The window would have reset by now, the ban outlives it.
    vi.advanceTimersByTime((rule.window + 1) * 1000)
    await expect(enforceRateLimit(event, route, rule)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('lets a banned caller back in once the ban expires', async () => {
    const route = nextRoute()
    const attempts = rule.limit * config.rateLimit.banMultiplier
    for (let i = 0; i < attempts; i++) await enforceRateLimit(event, route, rule).catch(() => {})

    vi.advanceTimersByTime((config.rateLimit.banSeconds + 1) * 1000)
    await expect(enforceRateLimit(event, route, rule)).resolves.toBeUndefined()
  })

  it('resets the counter after the window', async () => {
    const route = nextRoute()
    await hit(route, rule.limit)
    vi.advanceTimersByTime((rule.window + 1) * 1000)
    await expect(hit(route, rule.limit)).resolves.toBeUndefined()
  })

  it('counts each IP separately', async () => {
    const route = nextRoute()
    await hit(route, rule.limit)
    await expect(enforceRateLimit({ ip: '198.51.100.7' }, route, rule)).resolves.toBeUndefined()
  })

  it('counts every address of an IPv6 /64 together', async () => {
    const route = nextRoute()
    await hit(route, rule.limit, { ip: '2001:db8:1:2::1' })
    await expect(
      enforceRateLimit({ ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' }, route, rule),
    ).rejects.toMatchObject({ statusCode: 429 })
    await expect(enforceRateLimit({ ip: '2001:db8:1:3::1' }, route, rule)).resolves.toBeUndefined()
  })

  it('counts an IPv4-mapped address as its IPv4', async () => {
    const route = nextRoute()
    await hit(route, rule.limit, { ip: '::ffff:203.0.113.9' })
    await expect(enforceRateLimit({ ip: '203.0.113.9' }, route, rule)).rejects.toMatchObject({
      statusCode: 429,
    })
  })

  it('counts a signed-in user by id, not by IP', async () => {
    const route = nextRoute()
    session.user = { id: 'user-1' }
    await hit(route, rule.limit, { ip: '203.0.113.1' })
    // Same user, different IP: still over the limit.
    await expect(enforceRateLimit({ ip: '198.51.100.7' }, route, rule)).rejects.toMatchObject({
      statusCode: 429,
    })
  })
})

describe('rateLimitIP', () => {
  it.each([
    ['203.0.113.1', '203.0.113.1'],
    ['::ffff:203.0.113.1', '203.0.113.1'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
    ['unknown', 'unknown'],
  ])('maps %s to %s', (ip, expected) => {
    expect(rateLimitIP(ip)).toBe(expected)
  })
})

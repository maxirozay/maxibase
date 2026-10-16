import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetTestState, setConfig } from '../setup'

// Client globals of the plugin. Every call of the plugin stands for a tab of the same
// origin: they share localStorage and the Web Locks of Node's navigator.
const { fetchSpy, clearSpy, local } = vi.hoisted(() => {
  const local = new Map<string, string>()
  Object.assign(globalThis, {
    defineNuxtPlugin: (plugin: unknown) => plugin,
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => void local.set(key, value),
    },
  })
  return { fetchSpy: vi.fn(), clearSpy: vi.fn(async () => {}), local }
})

const session = { value: { user: { id: 'user-1' } } as Record<string, any> }
Object.assign(globalThis, {
  $fetch: fetchSpy,
  useUserSession: () => ({ session, clear: clearSpy }),
})

const { default: rotateTokenPlugin } = (await import('../../layers/base/app/plugins/session')) as {
  default: () => Promise<void>
}

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  resetTestState()
  setConfig({ public: { refreshToken: { rotateAfter: DAY / 1000 } } })
  local.clear()
  local.set('rotate-token-at', String(Date.now() - 2 * DAY))
  session.value = { user: { id: 'user-1' } }
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10)))
  clearSpy.mockClear()
})

describe('session plugin', () => {
  it('rotates a token older than rotateAfter', async () => {
    await rotateTokenPlugin()
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' })
    expect(Number(local.get('rotate-token-at'))).toBeGreaterThan(Date.now() - 1000)
  })

  it('keeps a recent token', async () => {
    local.set('rotate-token-at', String(Date.now() - 1000))
    await rotateTokenPlugin()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Each tab would send the same token: the first one rotates it, and the 401 of the
  // others deletes the cookie it just got, which signs the user out everywhere.
  it('rotates once when tabs load together', async () => {
    await Promise.all([rotateTokenPlugin(), rotateTokenPlugin(), rotateTokenPlugin()])
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(clearSpy).not.toHaveBeenCalled()
  })

  it('does not rotate again in a tab opened right after', async () => {
    await rotateTokenPlugin()
    await rotateTokenPlugin()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('still signs out when the token was revoked', async () => {
    fetchSpy.mockRejectedValue({ response: { status: 401 } })
    await rotateTokenPlugin()
    expect(clearSpy).toHaveBeenCalledOnce()
  })
})

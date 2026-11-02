import { describe, it, expect, beforeEach } from 'vitest'
import { resetTestState, logSpy } from '../setup'
import handler from '#server-api/log.post'

const call = (body: unknown) => (handler as any)({ body, path: '/api/log' })

beforeEach(resetTestState)

describe('POST /api/log', () => {
  it('records what the client reported', async () => {
    await call({ summary: 'boom', type: 'error', origin: 'app.vue' })
    expect(logSpy).toHaveBeenCalledWith('boom', {
      data: undefined,
      origin: 'client app.vue',
      type: 'error',
      event: expect.anything(),
    })
  })

  it('marks the origin as client even when none is sent', async () => {
    await call({ summary: 'x' })
    expect(logSpy.mock.calls[0]?.[1].origin).toBe('client')
  })

  // The endpoint is unauthenticated, so a client must not be able to forge rows
  // that read as server-side events in the admin log viewer.
  it('downgrades a type it does not recognise to info', async () => {
    await call({ summary: 'x', type: 'security' })
    expect(logSpy.mock.calls[0]?.[1].type).toBe('info')
  })

  it('leaves an absent type absent', async () => {
    await call({ summary: 'x' })
    expect(logSpy.mock.calls[0]?.[1].type).toBeUndefined()
  })

  it('rejects an oversized summary and oversized data', async () => {
    await expect(call({ summary: 'x'.repeat(1001) })).rejects.toThrow()
    await expect(call({ summary: 'x', data: { blob: 'y'.repeat(10001) } })).rejects.toThrow()
  })
})

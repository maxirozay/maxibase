import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EmptyFilter } from 'drizzle-orm/relations'
import { resetTestState } from '../setup'
import { prepareStringForSearch } from '#server-utils/text'

// The query schema reads it when the route loads
await vi.hoisted(async () => {
  const { logTypeValues } = await import('#shared-utils/logs')
  Object.assign(globalThis, { logTypeValues })
})
const { default: handler } = (await import('#server-api/admin/logs.get')) as any

const findMany = vi.fn(async () => [])

beforeEach(() => {
  resetTestState()
  findMany.mockClear()
  vi.stubGlobal('prepareStringForSearch', prepareStringForSearch)
  vi.stubGlobal('getValidatedQuery', async (event: any, parse: Function) => parse(event.query))
  vi.stubGlobal('db', { query: { authLogs: { findMany } } })
})

const range = { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }
const where = () => (findMany.mock.calls[0] as any)[0].where

describe('GET /api/admin/logs', () => {
  // drizzle throws on an undefined filter field
  it('skips the filters it was not given', async () => {
    await handler({ query: range })
    expect(where().type).toBe(EmptyFilter)
    expect(where().OR).toBe(EmptyFilter)
  })

  it('filters by type and search', async () => {
    await handler({ query: { ...range, type: 'error', search: 'boom' } })
    expect(where().type).toEqual({ eq: 'error' })
    expect(where().OR).toContainEqual({ summary: { ilike: '%boom%' } })
  })
})

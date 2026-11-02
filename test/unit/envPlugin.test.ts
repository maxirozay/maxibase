import { describe, it, expect } from 'vitest'
import { parseEnvValues } from '../../layers/base/server/plugins/env'

describe('parseEnvValues', () => {
  // "false" is truthy: left as a string, NUXT_FORCE_MFA=false would turn MFA on
  it('parses booleans and numbers at any depth', () => {
    const config = parseEnvValues({
      forceMfa: 'false',
      autoSignup: 'true',
      session: { maxAge: '600' },
      rateLimit: { routes: { '/api/log': { limit: '10', window: '3600' } } },
      public: { password: { min: '16' }, ratio: '0.5', offset: '-1' },
    })
    expect(config).toEqual({
      forceMfa: false,
      autoSignup: true,
      session: { maxAge: 600 },
      rateLimit: { routes: { '/api/log': { limit: 10, window: 3600 } } },
      public: { password: { min: 16 }, ratio: 0.5, offset: -1 },
    })
  })

  it('keeps the strings that are not quite numbers', () => {
    const values = { zip: '007', id: '12345678901234567890', empty: '', spaced: ' 1', hex: '0x10' }
    expect(parseEnvValues({ ...values })).toEqual(values)
  })

  it('leaves values that are not strings alone', () => {
    const config = { port: 465, enabled: true, list: ['1', 'true'], none: null }
    expect(parseEnvValues({ ...config })).toEqual(config)
  })
})

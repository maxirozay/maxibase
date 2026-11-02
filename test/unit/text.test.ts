import { describe, it, expect } from 'vitest'
import { prepareStringForSearch } from '#server-utils/text'

describe('prepareStringForSearch', () => {
  it('returns nothing for an empty search', () => {
    expect(prepareStringForSearch('')).toBeUndefined()
    expect(prepareStringForSearch()).toBeUndefined()
  })

  it('wraps the text to match anywhere', () => {
    expect(prepareStringForSearch('login')).toBe('%login%')
  })

  it('escapes the LIKE wildcards', () => {
    expect(prepareStringForSearch('100%_done')).toBe('%100\\%\\_done%')
  })

  // Postgres reads \ as the LIKE escape: unescaped, a trailing one makes the
  // pattern invalid and one before a letter is dropped from the search
  it('escapes backslashes', () => {
    expect(prepareStringForSearch('C:\\temp\\')).toBe('%C:\\\\temp\\\\%')
  })
})

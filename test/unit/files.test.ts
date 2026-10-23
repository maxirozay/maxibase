import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetTestState, session, setConfig } from '../setup'
import {
  readUploadBody,
  getSecurePath,
  removeRoot,
  parseRangeHeader,
  getFileURL,
  uploadChunk,
  cleanTempUploads,
  copyFile,
  deletePath,
  cleanFilename,
  getCacheControl,
  getFile,
  parseMaxAge,
} from '#server-utils/files'
import { parseParts } from '#server-api/files/chunk.post'

beforeEach(resetTestState)

describe('getSecurePath', () => {
  it('prefixes the configured root', () => {
    expect(getSecurePath('u/123/avatar.png')).toBe('files/private/u/123/avatar.png')
    expect(getSecurePath('logo.png', false)).toBe('files/public/logo.png')
  })

  it('does not prefix the root twice', () => {
    expect(getSecurePath('files/private/u/123')).toBe('files/private/u/123')
  })

  it('strips leading slashes and a trailing slash', () => {
    expect(getSecurePath('///u/123/')).toBe('files/private/u/123')
  })

  it('rejects traversal segments', () => {
    for (const path of [
      '../etc/passwd',
      'u/123/../../etc',
      'u/./123',
      '/../secrets',
      'u/123/..hidden',
      'u/123/a..b.png',
    ]) {
      expect(() => getSecurePath(path)).toThrowError(/Invalid path/)
    }
  })

  it('keeps single dots that are part of a name', () => {
    expect(getSecurePath('u/123/.hidden')).toBe('files/private/u/123/.hidden')
    expect(getSecurePath('u/123/file.tar.gz')).toBe('files/private/u/123/file.tar.gz')
  })

  it('follows a relocated root', () => {
    setConfig({ filesPrivateFolder: 'data/secret' })
    expect(getSecurePath('u/1')).toBe('data/secret/u/1')
  })
})

describe('removeRoot', () => {
  it('strips the root prefix once', () => {
    expect(removeRoot('files/private/u/1')).toBe('u/1')
    expect(removeRoot('u/1')).toBe('u/1')
  })
})

describe('getFileURL', () => {
  it('routes private files through the API and public files through the files host', () => {
    expect(getFileURL('files/private/u/1/a.png')).toBe(
      'https://app.test/api/files/u/1/a.png?isPrivate=true',
    )
    expect(getFileURL('files/public/logo.png', false)).toBe('/files/logo.png')
  })

  it('encodes characters that would break the URL', () => {
    expect(getFileURL('files/private/u/1/100% #1?.pdf')).toBe(
      'https://app.test/api/files/u/1/100%25%20%231%3F.pdf?isPrivate=true',
    )
    expect(getFileURL('files/public/été.png', false)).toBe('/files/%C3%A9t%C3%A9.png')
  })
})

describe('parseRangeHeader', () => {
  const size = 1000

  it('returns null without a range', () => {
    expect(parseRangeHeader(undefined, size)).toBeNull()
    expect(parseRangeHeader('items=0-10', size)).toBeNull()
  })

  it('parses a closed range and clamps the end to the last byte', () => {
    expect(parseRangeHeader('bytes=0-99', size)).toEqual({ start: 0, end: 99 })
    expect(parseRangeHeader('bytes=500-5000', size)).toEqual({ start: 500, end: 999 })
  })

  it('treats an open end as the rest of the file', () => {
    expect(parseRangeHeader('bytes=500-', size)).toEqual({ start: 500, end: 999 })
  })

  it('reads a suffix range from the end', () => {
    expect(parseRangeHeader('bytes=-200', size)).toEqual({ start: 800, end: 999 })
    // Asking for more than the file holds yields the whole file, not a negative start.
    expect(parseRangeHeader('bytes=-5000', size)).toEqual({ start: 0, end: 999 })
  })

  it('reports unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=1000-', size)).toBe('unsatisfiable')
    expect(parseRangeHeader('bytes=900-100', size)).toBe('unsatisfiable')
    expect(parseRangeHeader('bytes=-0', size)).toBe('unsatisfiable')
  })
})

describe('cleanFilename', () => {
  it('turns spaces and symbols into single dashes and keeps accents', () => {
    expect(cleanFilename('Rapport été 2026 (final).pdf')).toBe('Rapport-été-2026-final.pdf')
    expect(cleanFilename('100% #1?.pdf')).toBe('100-1.pdf')
    expect(cleanFilename('a - b_c.tar.gz')).toBe('a-b_c.tar.gz')
  })

  it('composes decomposed accents so macOS names match', () => {
    expect(cleanFilename('été.png')).toBe('été.png')
  })

  it('drops any folder and trims dashes and dots at the ends', () => {
    expect(cleanFilename('dir/sub/ -name- .txt')).toBe('name.txt')
    expect(cleanFilename('name.')).toBe('name')
  })

  it('keeps a visible name when nothing or only an extension is left', () => {
    expect(cleanFilename('???.pdf')).toBe('file.pdf')
    expect(cleanFilename('.env')).toBe('file.env')
    expect(cleanFilename('***')).toBe('file')
  })
})

describe('getCacheControl', () => {
  it('caches public files for a year and private ones for an hour by default', () => {
    expect(getCacheControl(false)).toBe('public, max-age=31536000')
    expect(getCacheControl(true)).toBe('private, max-age=3600')
  })

  it('uses the given max age', () => {
    expect(getCacheControl(false, 60)).toBe('public, max-age=60')
    expect(getCacheControl(true, 60)).toBe('private, max-age=60')
  })

  it('disables caching for a max age of 0', () => {
    expect(getCacheControl(false, 0)).toBe('no-store, no-cache')
    expect(getCacheControl(true, 0)).toBe('no-store, no-cache')
  })
})

describe('parseMaxAge', () => {
  it('reads whole seconds and leaves a missing value undefined', () => {
    expect(parseMaxAge('60')).toBe(60)
    expect(parseMaxAge('0')).toBe(0)
    expect(parseMaxAge('')).toBeUndefined()
    expect(parseMaxAge(undefined)).toBeUndefined()
  })

  it('rejects anything but a non-negative integer with a 400', () => {
    for (const value of ['-1', '1.5', 'abc', 'Infinity']) {
      expect(() => parseMaxAge(value)).toThrow(expect.objectContaining({ statusCode: 400 }))
    }
  })
})

describe('upload size limit', () => {
  const event = {} as any
  const chunkUpload = (chunk: Buffer, totalChunks: number) =>
    uploadChunk(event, {
      chunkIndex: 0,
      totalChunks,
      filename: 'big.bin',
      type: 'application/octet-stream',
      chunk,
      path: 'u/123',
      isPrivate: true,
      parts: [],
    })

  it('rejects more chunks than the max size allows', async () => {
    await expect(chunkUpload(Buffer.alloc(1), 3)).rejects.toMatchObject({ statusCode: 413 })
  })

  it('rejects a filename containing ..', async () => {
    session.user = { id: '123' }
    for (const filename of ['..', 'a..b.png']) {
      await expect(
        uploadChunk(event, {
          chunkIndex: 0,
          totalChunks: 1,
          filename,
          type: 'application/octet-stream',
          chunk: Buffer.alloc(1),
          path: 'u/123',
          isPrivate: true,
          parts: [],
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid path' })
    }
  })
})

describe('parseParts', () => {
  it('accepts S3 parts, local parts and nothing', () => {
    expect(parseParts('[{"ETag":"e1","PartNumber":1},{"PartNumber":2}]')).toEqual([
      { ETag: 'e1', PartNumber: 1 },
      { PartNumber: 2 },
    ])
    expect(parseParts(undefined)).toEqual([])
    expect(parseParts('')).toEqual([])
  })

  it('rejects malformed parts with a 400', () => {
    for (const value of ['{', '{}', '[{"PartNumber":0}]', '[{"PartNumber":"1"}]', '[null]']) {
      expect(() => parseParts(value)).toThrowError(
        expect.objectContaining({ statusCode: 400, message: 'Invalid chunk upload' }),
      )
    }
  })
})

describe('readUploadBody', () => {
  const MB = 1024 * 1024
  const event = {} as any
  const getRequestHeader = vi.mocked((globalThis as any).getRequestHeader)
  const readMultipartFormData = vi.mocked((globalThis as any).readMultipartFormData)

  beforeEach(() => {
    session.user = { id: '123' }
    getRequestHeader.mockReset()
    readMultipartFormData.mockClear()
  })

  it('rejects an anonymous request before reading the body', async () => {
    delete session.user
    await expect(readUploadBody(event, 5)).rejects.toMatchObject({ statusCode: 401 })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('rejects a body without a length', async () => {
    await expect(readUploadBody(event, 5)).rejects.toMatchObject({ statusCode: 411 })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('rejects a body over the limit before reading it', async () => {
    getRequestHeader.mockReturnValue(String(6 * MB + 1))
    await expect(readUploadBody(event, 5)).rejects.toMatchObject({ statusCode: 413 })
    expect(readMultipartFormData).not.toHaveBeenCalled()
  })

  it('reads a body within the limit', async () => {
    getRequestHeader.mockReturnValue(String(5 * MB))
    await readUploadBody(event, 5)
    expect(readMultipartFormData).toHaveBeenCalledWith(event)
  })
})

describe('cleanTempUploads', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-base-'))
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(cwd, { recursive: true, force: true })
  })

  it('deletes uploads without a chunk for 24 hours and keeps recent ones', async () => {
    const tempDir = join(cwd, 'files', 'temp')
    const stale = join(tempDir, 'stale')
    await mkdir(stale, { recursive: true })
    await writeFile(join(stale, '0'), 'a')
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(join(stale, '0'), old, old)
    await utimes(stale, old, old)

    await mkdir(join(tempDir, 'recent'))
    await writeFile(join(tempDir, 'recent', '0'), 'a')

    await cleanTempUploads()

    expect(await readdir(tempDir)).toEqual(['recent'])
  })

  it('does nothing before any chunked upload', async () => {
    await expect(cleanTempUploads()).resolves.toBeUndefined()
  })
})

describe('copyFile and deletePath', () => {
  const event = {} as any
  let cwd: string
  const privatePath = (path: string) => join(cwd, 'files', 'private', path)

  beforeEach(async () => {
    session.user = { id: '123' }
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-base-'))
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    await mkdir(privatePath('u/123'), { recursive: true })
    await writeFile(privatePath('u/123/a.txt'), 'hello')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(cwd, { recursive: true, force: true })
  })

  it('leaves a file copied or moved onto itself untouched', async () => {
    await copyFile(event, 'u/123/a.txt', 'u/123/a.txt')
    await copyFile(event, 'u/123/a.txt', 'u/123//a.txt/', true, true)
    expect(await readFile(privatePath('u/123/a.txt'), 'utf8')).toBe('hello')
  })

  it('moves a file', async () => {
    await copyFile(event, 'u/123/a.txt', 'u/123/sub/b.txt', true, true)
    expect(await readFile(privatePath('u/123/sub/b.txt'), 'utf8')).toBe('hello')
    expect(await readdir(privatePath('u/123'))).toEqual(['sub'])
  })

  it('refuses to delete the root folder', async () => {
    session.user = { id: '1', role: 'admin' }
    for (const path of ['/', '//', '///']) {
      await expect(deletePath(event, path)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid path',
      })
    }
    expect(await readFile(privatePath('u/123/a.txt'), 'utf8')).toBe('hello')
  })

  it('deletes a file and its emptied folders', async () => {
    await deletePath(event, 'u/123/a.txt')
    expect(await readdir(join(cwd, 'files', 'private'))).toEqual([])
  })

  it('stores an upload under its cleaned name', async () => {
    const url = await uploadChunk(event, {
      chunkIndex: 0,
      totalChunks: 1,
      filename: 'Rapport été (final).pdf',
      type: 'application/pdf',
      chunk: Buffer.from('pdf'),
      path: 'u/123',
      isPrivate: true,
      parts: [],
    })
    expect(url).toBe(
      'https://app.test/api/files/u/123/Rapport-%C3%A9t%C3%A9-final.pdf?isPrivate=true',
    )
    expect(await readFile(privatePath('u/123/Rapport-été-final.pdf'), 'utf8')).toBe('pdf')
  })

  it('rejects a missing source without creating the destination', async () => {
    await expect(copyFile(event, 'u/123/missing.txt', 'u/123/sub/b.txt')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(await readdir(privatePath('u/123'))).toEqual(['a.txt'])
  })
})

describe('getFile', () => {
  const event = {} as any
  const setHeader = vi.mocked((globalThis as any).setHeader)
  let cwd: string

  beforeEach(async () => {
    session.user = { id: '123' }
    cwd = await mkdtemp(join(tmpdir(), 'nuxt-base-'))
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    await mkdir(join(cwd, 'files', 'private', 'u/123'), { recursive: true })
    for (const name of ['report.pdf', 'notes']) {
      await writeFile(join(cwd, 'files', 'private', 'u/123', name), 'hello')
    }
    setHeader.mockClear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(cwd, { recursive: true, force: true })
  })

  const contentType = async (path: string) => {
    const stream: any = await getFile(event, path, true)
    stream.destroy()
    return setHeader.mock.calls.find(([, name]) => name === 'Content-Type')?.[2]
  }

  it('serves a local file with the type of its extension', async () => {
    expect(await contentType('u/123/report.pdf')).toBe('application/pdf')
  })

  it('falls back to a download type without a known extension', async () => {
    expect(await contentType('u/123/notes')).toBe('application/octet-stream')
  })
})

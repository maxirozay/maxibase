import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from 'fs/promises'
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
} from '#server-utils/files'

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

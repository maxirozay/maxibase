import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  S3Client,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { resetTestState, session, setConfig } from '../setup'
import {
  copyFile,
  deleteUserFiles,
  getFile,
  listFolder,
  uploadChunk,
  uploadFile,
} from '#server-utils/files'

// Kept apart from files.test.ts: the S3 client is cached once created, so every
// upload in this file goes to S3.

const send = vi.spyOn(S3Client.prototype, 'send')
const event = {} as any

beforeEach(() => {
  resetTestState()
  setConfig({
    s3: {
      endpoint: 'https://s3.test',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      privateBucket: 'private',
      publicBucket: 'public',
    },
  })
  session.user = { id: '123' }
  send.mockReset()
  send.mockImplementation(async (command: any) =>
    command instanceof CreateMultipartUploadCommand ? { UploadId: 'upload-1' } : { ETag: '"e"' },
  )
})

const sent = <T>(type: new (...args: any[]) => T) =>
  send.mock.calls.map(([command]) => command).find((command) => command instanceof type) as T

const chunkedUpload = (maxAge?: number, totalChunks = 2) =>
  uploadChunk(event, {
    chunkIndex: 0,
    totalChunks,
    filename: 'big.bin',
    type: 'application/octet-stream',
    chunk: Buffer.alloc(1),
    path: 'u/123',
    isPrivate: true,
    parts: [],
    maxAge,
  })

describe('S3 upload cache', () => {
  it('stores the requested max age on a single upload', async () => {
    const file = new File(['x'], 'logo.png', { type: 'image/png' })
    expect(await uploadFile(event, file, 'u/123', false, 60)).toBe(
      '/files/files/public/u/123/logo.png',
    )
    expect(sent(PutObjectCommand).input.CacheControl).toBe('public, max-age=60')
  })

  it('starts a chunked upload with the requested max age', async () => {
    expect(await chunkedUpload(0)).toMatchObject({ uploadId: 'upload-1' })
    expect(sent(CreateMultipartUploadCommand).input.CacheControl).toBe('no-store, no-cache')
  })

  it('gives a chunked upload the default cache when no max age is given', async () => {
    await chunkedUpload()
    expect(sent(CreateMultipartUploadCommand).input.CacheControl).toBe('private, max-age=3600')
  })
})

// A presigned URL expires, the API route signs a fresh one on every request
describe('S3 private file URLs', () => {
  const privateURL = 'https://app.test/api/files/u/123/big.bin?isPrivate=true'

  it('returns the API URL after a single upload', async () => {
    const file = new File(['x'], 'big.bin')
    expect(await uploadFile(event, file, 'u/123', true)).toBe(privateURL)
  })

  it('returns the API URL after a chunked upload', async () => {
    expect(await chunkedUpload(undefined, 1)).toBe(privateURL)
  })

  it('lists files with their API URL', async () => {
    send.mockImplementation(async (command: any) =>
      command instanceof ListObjectsV2Command
        ? { Contents: [{ Key: 'files/private/u/123/big.bin', Size: 1 }] }
        : {},
    )
    const [file] = await listFolder(event, 'u/123', true)
    expect(file!.url).toBe(privateURL)
  })
})

describe('S3 copy', () => {
  it('keeps a public file public', async () => {
    await copyFile(event, 'u/123/a.png', 'u/123/b.png', false)
    expect(sent(CopyObjectCommand).input.ACL).toBe('public-read')
  })

  it('sets no ACL on a private file', async () => {
    await copyFile(event, 'u/123/a.png', 'u/123/b.png', true)
    expect(sent(CopyObjectCommand).input.ACL).toBeUndefined()
  })
})

describe('S3 proxied file', () => {
  const fetchStatus = (status: number) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }))

  it('reports a missing file as not found', async () => {
    const fetch = fetchStatus(404)
    await expect(getFile(event, 'u/123/gone.png', true, undefined, false)).rejects.toMatchObject({
      statusCode: 404,
    })
    fetch.mockRestore()
  })

  it('reports any other S3 failure as a bad gateway', async () => {
    const fetch = fetchStatus(500)
    await expect(getFile(event, 'u/123/a.png', true, undefined, false)).rejects.toMatchObject({
      statusCode: 502,
    })
    fetch.mockRestore()
  })
})

describe('S3 user files deletion', () => {
  const objects: Record<string, string[]> = {}
  const listed = () =>
    send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof ListObjectsV2Command)
      .map((command: any) => `${command.input.Bucket}:${command.input.Prefix}`)
  const deleted = () =>
    send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand)
      .flatMap((command: any) => command.input.Delete.Objects.map((object: any) => object.Key))

  beforeEach(() => {
    delete session.user
    for (const bucket of Object.keys(objects)) delete objects[bucket]
    send.mockImplementation(async (command: any) =>
      command instanceof ListObjectsV2Command
        ? { Contents: (objects[command.input.Bucket] ?? []).map((Key) => ({ Key })) }
        : {},
    )
  })

  // Most users never upload: listing finds nothing, so nothing is deleted
  it('only lists both buckets for a user without files', async () => {
    await deleteUserFiles('456')
    expect(listed()).toEqual(['private:files/private/u/456', 'public:files/public/u/456'])
    expect(deleted()).toEqual([])
  })

  // u/123 is a prefix of u/1234, whose files must stay
  it('deletes the user files and nobody else', async () => {
    objects.private = ['files/private/u/123/a.txt', 'files/private/u/1234/b.txt']
    objects.public = ['files/public/u/123/logo.png']
    await deleteUserFiles('123')
    expect(deleted()).toEqual(['files/private/u/123/a.txt', 'files/public/u/123/logo.png'])
  })

  it('skips a bucket that is not configured', async () => {
    setConfig({ s3: { endpoint: 'https://s3.test', accessKeyId: 'key', privateBucket: 'private' } })
    await deleteUserFiles('456')
    expect(listed()).toEqual(['private:files/private/u/456'])
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  S3Client,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { resetTestState, session, setConfig } from '../setup'
import { copyFile, listFolder, uploadChunk, uploadFile } from '#server-utils/files'

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
    const file = { name: 'file', filename: 'logo.png', type: 'image/png', data: Buffer.alloc(1) }
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
    const file = { name: 'file', filename: 'big.bin', data: Buffer.alloc(1) }
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

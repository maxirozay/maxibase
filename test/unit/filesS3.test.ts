import { describe, it, expect, beforeEach, vi } from 'vitest'
import { S3Client, CreateMultipartUploadCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { resetTestState, session, setConfig } from '../setup'
import { uploadChunk, uploadFile } from '#server-utils/files'

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

const startChunkedUpload = (maxAge?: number) =>
  uploadChunk(event, {
    chunkIndex: 0,
    totalChunks: 2,
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
    await uploadFile(event, file, 'u/123', false, 60)
    expect(sent(PutObjectCommand).input.CacheControl).toBe('public, max-age=60')
  })

  it('starts a chunked upload with the requested max age', async () => {
    expect(await startChunkedUpload(0)).toMatchObject({ uploadId: 'upload-1' })
    expect(sent(CreateMultipartUploadCommand).input.CacheControl).toBe('no-store, no-cache')
  })

  it('gives a chunked upload the default cache when no max age is given', async () => {
    await startChunkedUpload()
    expect(sent(CreateMultipartUploadCommand).input.CacheControl).toBe('private, max-age=3600')
  })
})

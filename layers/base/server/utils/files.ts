import { join, dirname, basename } from 'path'
import {
  mkdir,
  readdir,
  writeFile,
  stat,
  rm,
  appendFile,
  rename,
  readFile as fsReadFile,
} from 'fs/promises'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { CompletedPart } from '@aws-sdk/client-s3'
import { checkFileAccess } from '#server/database/access'
import { createReadStream, createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import type { Readable } from 'stream'
import type { H3Event, MultiPartData } from 'h3'
import { createHash } from 'crypto'

export async function uploadFile(
  event: H3Event,
  file: MultiPartData,
  path = 'files',
  isPrivate = true,
) {
  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)
  if (file.filename && !/[^/]\.[^.]+$/.test(path) && basename(path) !== basename(file.filename)) {
    path = join(path, basename(file.filename))
  }

  let url
  if (useS3()) {
    const s3Key = getS3Key(path)
    url = await uploadToS3(
      s3Key,
      file.data,
      file.type || 'application/octet-stream',
      undefined,
      isPrivate,
    )
  } else {
    const filePath = join(process.cwd(), path)
    const folderPath = filePath.replace(/\/[^/]*$/, '')
    await mkdir(folderPath, { recursive: true })
    await writeFile(filePath, file.data)

    url = getFileURL(path, isPrivate)
  }
  return url
}

// Same as uploadFile but for a file the server produces itself
export async function uploadStream(
  event: H3Event,
  file: { stream: Readable; filename?: string; type?: string },
  path = 'files',
  isPrivate = true,
) {
  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)
  if (file.filename && !/[^/]\.[^.]+$/.test(path) && basename(path) !== basename(file.filename)) {
    path = join(path, basename(file.filename))
  }

  if (useS3()) {
    return uploadStreamToS3(
      getS3Key(path),
      file.stream,
      file.type || 'application/octet-stream',
      undefined,
      isPrivate,
    )
  }

  const filePath = join(process.cwd(), path)
  await mkdir(dirname(filePath), { recursive: true })

  const tmpPath = `${filePath}.${crypto.randomUUID()}.part`
  try {
    await pipeline(file.stream, createWriteStream(tmpPath))
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }

  return getFileURL(path, isPrivate)
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(value: string) {
  return UUID_REGEX.test(value)
}

export async function uploadChunk(
  event: H3Event,
  {
    uploadId,
    chunkIndex,
    totalChunks,
    filename,
    type,
    chunk,
    path,
    isPrivate,
    parts,
  }: {
    uploadId?: string
    chunkIndex: number
    totalChunks: number
    filename: string
    type: string
    chunk: Buffer
    path: string
    isPrivate: boolean
    parts: CompletedPart[]
  },
) {
  if (chunkIndex < 0 || chunkIndex >= totalChunks || totalChunks < 1) {
    throw createError({ statusCode: 400, message: 'Invalid chunk index' })
  }

  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)
  if (filename && !/[^/]\.[^.]+$/.test(path) && basename(path) !== basename(filename)) {
    path = join(path, basename(filename))
  }

  if (useS3()) {
    if (!uploadId) {
      uploadId = (await initMultipartUploadToS3(getS3Key(path), type, isPrivate))!
      parts = []
    }

    if (parts.length < totalChunks) {
      const part = await uploadPartToS3(getS3Key(path), chunk, uploadId!, chunkIndex + 1, isPrivate)
      if (part) parts.push(part)
      if (parts.length < totalChunks) {
        return { uploadId, parts }
      }
    }

    return completeMultipartUploadToS3(getS3Key(path), uploadId!, parts, isPrivate)
  }

  if (!uploadId) {
    uploadId = crypto.randomUUID()
    parts = []
  } else if (!isUUID(uploadId)) {
    throw createError({ statusCode: 400, message: 'Invalid upload id' })
  }

  const tmpDir = join(process.cwd(), 'files', 'temp', uploadId)
  await mkdir(tmpDir, { recursive: true })
  await writeFile(join(tmpDir, String(chunkIndex)), chunk)

  const receivedChunks = await readdir(tmpDir)
  if (receivedChunks.length < totalChunks) {
    parts = receivedChunks.map((_file, index) => ({
      PartNumber: index + 1,
    }))
    return { uploadId, parts }
  }

  const fullPath = join(process.cwd(), path)
  await mkdir(dirname(fullPath), { recursive: true })
  for (let i = 0; i < totalChunks; i++) {
    const data = await fsReadFile(join(tmpDir, String(i)))
    if (i === 0) await writeFile(fullPath, data)
    else await appendFile(fullPath, data)
  }
  await rm(tmpDir, { recursive: true, force: true })

  return getFileURL(path, isPrivate)
}

export function getFileURL(path: string, isPrivate = true) {
  const config = useRuntimeConfig()
  const url = removeRoot(path, isPrivate)

  if (isPrivate) {
    return config.public.url + join('/', 'api/files', url) + '?isPrivate=true'
  }
  return config.public.files.url + join('/', url)
}

export function parseRangeHeader(range: string | undefined, size: number) {
  if (!range) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return null

  const [, startRaw, endRaw] = match
  let start: number
  let end: number

  if (startRaw) {
    start = Number(startRaw)
    end = endRaw ? Math.min(Number(endRaw), size - 1) : size - 1
  } else {
    // `bytes=-N` asks for the last N bytes
    if (!endRaw || Number(endRaw) === 0) return 'unsatisfiable' as const
    start = Math.max(size - Number(endRaw), 0)
    end = size - 1
  }

  if (start > end || start >= size) return 'unsatisfiable' as const

  return { start, end }
}

export async function getFile(
  event: H3Event,
  path: string,
  isPrivate = false,
  cache: RequestCache = 'no-cache',
  expireIn?: number,
  redirect?: boolean,
) {
  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)

  const range = getRequestHeader(event, 'range')

  if (useS3()) {
    const url = await getS3SignedUrl(getS3Key(path), expireIn, isPrivate)

    if (redirect ?? useRuntimeConfig().s3.redirect) {
      setHeader(event, 'Cache-Control', 'no-store')
      return sendRedirect(event, url, 302)
    }

    const response = await fetch(url, { cache, headers: range ? { range } : undefined })

    if (response.status === 416) {
      const contentRange = response.headers.get('content-range')
      if (contentRange) setHeader(event, 'Content-Range', contentRange)
      throw createError({ statusCode: 416, message: 'Range not satisfiable' })
    }
    if (!response.ok) throw createError({ statusCode: 502, message: 'Failed to fetch file' })

    const passthrough = {
      'Content-Type': response.headers.get('content-type'),
      'Content-Length': response.headers.get('content-length'),
      'Content-Range': response.headers.get('content-range'),
      'Accept-Ranges': response.headers.get('accept-ranges') || 'bytes',
    }
    for (const [name, value] of Object.entries(passthrough)) {
      if (value) setHeader(event, name, value)
    }
    if (response.status === 206) setResponseStatus(event, 206)

    return response.body
  }

  const fullPath = join(process.cwd(), path)

  const stats = await stat(fullPath).catch(() => null)
  if (!stats?.isFile()) {
    throw createError({ statusCode: 404, message: 'File not found' })
  }

  setHeader(event, 'Accept-Ranges', 'bytes')

  const parsedRange = parseRangeHeader(range, stats.size)
  if (parsedRange === 'unsatisfiable') {
    setHeader(event, 'Content-Range', `bytes */${stats.size}`)
    throw createError({ statusCode: 416, message: 'Range not satisfiable' })
  }

  if (parsedRange) {
    const { start, end } = parsedRange
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${stats.size}`)
    setHeader(event, 'Content-Length', end - start + 1)
    return createReadStream(fullPath, { start, end })
  }

  setHeader(event, 'Content-Length', stats.size)
  return createReadStream(fullPath)
}

export async function deletePath(event: H3Event, path: string, isPrivate = true) {
  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)
  if (useS3()) await deleteFromS3(path, isPrivate)
  else {
    const localPath = join(process.cwd(), path)
    await rm(localPath, { recursive: true, force: true })
    const config = useRuntimeConfig()
    const root = isPrivate ? config.filesPrivateFolder : config.filesPublicFolder
    await deleteEmptyFolder(dirname(localPath), root)
  }
}

async function deleteEmptyFolder(directory: string, root: string) {
  try {
    if (directory === join(process.cwd(), root)) return
    const files = await readdir(directory)
    if (files.length > 0) return

    await rm(directory, { recursive: true })
    await deleteEmptyFolder(dirname(directory), root)
  } catch {}
}

type ListedFile = {
  name: string
  size: number
  updatedAt: Date
  path: string
  url: string
}

export async function listFolder(
  event: H3Event,
  path: string,
  isPrivate = true,
): Promise<ListedFile[]> {
  await checkFileAccess(event, path)
  path = getSecurePath(path, isPrivate)

  if (useS3()) return await listFromS3(path, isPrivate)
  const localPath = join(process.cwd(), path)
  const filesStats = await readdir(localPath).catch(() => [])
  return (
    await Promise.all(
      filesStats.map(async (name) => {
        const localeFilePath = join(localPath, name)
        const stats = await stat(localeFilePath)
        const rootedPath = join(path, name)
        const filePath = removeRoot(rootedPath, isPrivate)
        return stats.isDirectory()
          ? await listFolder(event, filePath, isPrivate)
          : {
              name,
              size: stats.size,
              updatedAt: stats.mtime,
              path: filePath,
              url: getFileURL(rootedPath, isPrivate),
            }
      }),
    )
  ).flat()
}

export async function copyFile(
  event: H3Event,
  src: string,
  dest: string,
  isPrivate = true,
  deleteSrc = false,
) {
  await checkFileAccess(event, src)
  await checkFileAccess(event, dest)
  src = getSecurePath(src, isPrivate)
  dest = getSecurePath(dest, isPrivate)

  if (useS3()) return copyFromS3(src, dest, isPrivate, deleteSrc)

  const srcPath = join(process.cwd(), src)
  const destPath = join(process.cwd(), dest)
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, createReadStream(srcPath))

  if (deleteSrc) {
    await deletePath(event, removeRoot(src, isPrivate), isPrivate)
  }
}

export async function copyFiles(
  event: H3Event,
  src: string,
  dest: string,
  isPrivate = true,
  deleteSrc = false,
) {
  const files = await listFolder(event, src, isPrivate)
  const normalizedSrc = removeRoot(getSecurePath(src, isPrivate), isPrivate)
  const normalizedDest = removeRoot(getSecurePath(dest, isPrivate), isPrivate)
  return Promise.all(
    files.map((file) =>
      copyFile(
        event,
        file.path,
        join(normalizedDest, file.path.substring(normalizedSrc.length + 1)),
        isPrivate,
        deleteSrc,
      ),
    ),
  )
}

export function getSecurePath(path: string, isPrivate = true) {
  const config = useRuntimeConfig()
  const root = isPrivate ? config.filesPrivateFolder : config.filesPublicFolder
  let normalizedPath = path.replace(/^\/+/, '')

  if (normalizedPath.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  normalizedPath = join('/', root, removeRoot(normalizedPath, isPrivate))

  return normalizedPath.replace(/^\//, '').replace(/\/$/, '')
}

export function removeRoot(path: string, isPrivate = true) {
  const config = useRuntimeConfig()
  const root = isPrivate ? config.filesPrivateFolder : config.filesPublicFolder
  return path.replace(new RegExp(`^${root}/`), '')
}

// S3

let s3Client: S3Client | null = null

export const useS3 = () => {
  const config = useRuntimeConfig()

  if (!s3Client && config.s3.endpoint && config.s3.accessKeyId) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: true,
    })
  }
  return s3Client
}

export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string,
  cache = 'public, max-age=31536000',
  isPrivate = true,
) {
  const client = useS3()
  if (!client) return null

  const config = useRuntimeConfig()

  if (isPrivate) {
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3.privateBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cache || 'public, max-age=31536000',
      }),
    )

    return getS3SignedUrl(key)
  }
  await client.send(
    new PutObjectCommand({
      Bucket: config.s3.publicBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cache || 'public, max-age=31536000',
      ACL: 'public-read',
    }),
  )

  return getS3URL(key)
}

export async function uploadStreamToS3(
  key: string,
  body: Readable,
  contentType: string,
  cache = 'public, max-age=31536000',
  isPrivate = true,
) {
  const client = useS3()
  if (!client) return null

  const config = useRuntimeConfig()
  const partSize = 5 * 1024 * 1024 // S3 minimum, only the last part may be smaller

  let uploadId: string | undefined
  const parts: CompletedPart[] = []
  let pending: Buffer[] = []
  let pendingSize = 0

  const sendPart = async (part: Buffer) => {
    if (!uploadId) {
      uploadId = (await initMultipartUploadToS3(key, contentType, isPrivate, cache))!
    }
    const uploaded = await uploadPartToS3(key, part, uploadId, parts.length + 1, isPrivate)
    if (uploaded) parts.push(uploaded)
  }

  try {
    for await (const chunk of body) {
      pending.push(chunk)
      pendingSize += chunk.length

      while (pendingSize >= partSize) {
        const merged = Buffer.concat(pending, pendingSize)
        await sendPart(merged.subarray(0, partSize))
        pending = [merged.subarray(partSize)]
        pendingSize = merged.length - partSize
      }
    }

    // Never reached a full part, so there is nothing to assemble.
    if (!uploadId) {
      return uploadToS3(key, Buffer.concat(pending, pendingSize), contentType, cache, isPrivate)
    }

    if (pendingSize) await sendPart(Buffer.concat(pending, pendingSize))

    return completeMultipartUploadToS3(key, uploadId, parts, isPrivate)
  } catch (error) {
    if (uploadId) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
            Key: key,
            UploadId: uploadId,
          }),
        )
        .catch(() => {})
    }
    throw error
  }
}

export async function initMultipartUploadToS3(
  key: string,
  contentType: string,
  isPrivate = true,
  cache?: string,
) {
  const client = useS3()
  if (!client) return null

  const config = useRuntimeConfig()

  const command = new CreateMultipartUploadCommand({
    Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
    Key: key,
    ContentType: contentType,
    CacheControl: cache,
    ACL: isPrivate ? undefined : 'public-read',
  })

  const { UploadId } = await client.send(command)
  return UploadId
}

export async function uploadPartToS3(
  key: string,
  body: Buffer,
  uploadId: string,
  partNumber: number,
  isPrivate = true,
) {
  const client = useS3()
  if (!client) return null

  const config = useRuntimeConfig()

  const response = await client.send(
    new UploadPartCommand({
      Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
      Key: key,
      Body: body,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
  )

  return { ETag: response.ETag, PartNumber: partNumber }
}

export async function completeMultipartUploadToS3(
  key: string,
  uploadId: string,
  parts: CompletedPart[],
  isPrivate = true,
) {
  const client = useS3()
  if (!client) return null

  const config = useRuntimeConfig()

  const command = new CompleteMultipartUploadCommand({
    Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  })

  await client.send(command)
  return isPrivate ? getS3SignedUrl(key) : getS3URL(key)
}

export async function deleteFromS3(path: string, isPrivate = true) {
  const client = useS3()
  if (!client) return

  const config = useRuntimeConfig()
  const bucket = isPrivate ? config.s3.privateBucket : config.s3.publicBucket

  let ContinuationToken: string | undefined
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: path, ContinuationToken }),
    )
    ContinuationToken = response.NextContinuationToken

    const keys = (response.Contents || [])
      .filter((item) => item.Key === path || item.Key?.startsWith(`${path}/`))
      .map((item) => ({ Key: item.Key! }))

    if (keys.length) {
      const command = new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } })
      // Infomaniak (OpenStack Swift) requires Content-MD5 instead of the SDK's default CRC32
      command.middlewareStack.addRelativeTo(
        (next: any) => async (args: any) => {
          const headers = args.request.headers
          for (const name of Object.keys(headers)) {
            if (name.startsWith('x-amz-checksum-') || name === 'x-amz-sdk-checksum-algorithm') {
              delete headers[name]
            }
          }
          headers['content-md5'] = createHash('md5').update(args.request.body).digest('base64')
          return next(args)
        },
        { relation: 'after', toMiddleware: 'flexibleChecksumsMiddleware' },
      )
      const result = await client.send(command)
      if (result.Errors?.length) {
        throw createError({
          statusCode: 502,
          message: `Failed to delete ${result.Errors.length} file(s): ${result.Errors.map((e) => `${e.Key} (${e.Code})`).join(', ')}`,
        })
      }
    }
  } while (ContinuationToken)
}

export async function listFromS3(path: string, isPrivate = true) {
  const client = useS3()
  if (!client) return []

  const config = useRuntimeConfig()

  let ContinuationToken: string | undefined
  const files = []
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
        Prefix: path,
        ContinuationToken,
      }),
    )
    ContinuationToken = response.NextContinuationToken
    files.push(
      ...(await Promise.all(
        (response.Contents || [])
          .filter((item) => item.Key === path || item.Key?.startsWith(`${path}/`))
          .map(async (item) => ({
            path: removeRoot(item.Key || '', isPrivate),
            name: item.Key?.split('/').pop() || '',
            url: isPrivate ? await getS3SignedUrl(item.Key || '') : getS3URL(item.Key || ''),
            updatedAt: item.LastModified ?? new Date(0),
            size: item.Size || 0,
          })),
      )),
    )
  } while (ContinuationToken)

  return files
}

export async function copyFromS3(src: string, dest: string, isPrivate = true, deleteSrc = false) {
  const client = useS3()
  if (!client) return

  const config = useRuntimeConfig()
  const bucket = isPrivate ? config.s3.privateBucket : config.s3.publicBucket
  const copySource = `/${bucket}/${src}`.split('/').map(encodeURIComponent).join('/')
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: dest,
      CopySource: copySource,
    }),
  )
  if (deleteSrc) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: src,
      }),
    )
  }
}

export function getS3Key(path: string) {
  const key = path.replace(/\\/g, '/')
  return key.startsWith('/') ? key.substring(1) : key
}

function getS3URL(path: string) {
  const config = useRuntimeConfig()
  return `${config.public.files.url}/${getS3Key(path)}`
}

async function getS3SignedUrl(key: string, expiresIn = 3600, isPrivate = true): Promise<string> {
  const client = useS3()
  if (!client) return ''

  const config = useRuntimeConfig()

  const command = new GetObjectCommand({
    Bucket: isPrivate ? config.s3.privateBucket : config.s3.publicBucket,
    Key: getS3Key(key),
  })

  return await getSignedUrl(client, command, { expiresIn })
}

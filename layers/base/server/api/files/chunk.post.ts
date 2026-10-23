import { z } from 'zod'

const partsSchema = z.array(
  z.object({
    ETag: z.string().optional(), // absent on local uploads
    PartNumber: z.number().int().positive(),
  }),
)

function invalidChunkUpload() {
  return createError({ status: 400, message: 'Invalid chunk upload' })
}

export function parseParts(value?: string) {
  try {
    return partsSchema.parse(JSON.parse(value || '[]'))
  } catch {
    throw invalidChunkUpload()
  }
}

export default defineEventHandler(async (event) => {
  const body = await readUploadBody(event, Number(useRuntimeConfig().public.files.chunkSize) || 1)
  if (!body) throw createError({ status: 400, message: 'No data' })

  const get = (name: string) => {
    const value = body.get(name)
    return typeof value === 'string' ? value.trim() : undefined
  }

  const uploadId = get('uploadId')
  const chunkIndex = Number(get('chunkIndex'))
  const totalChunks = Number(get('totalChunks'))
  const filename = get('filename')
  const type = get('type') || 'application/octet-stream'
  const path = get('path') || 'files'
  const isPrivate = get('isPrivate') !== 'false'
  const parts = parseParts(get('parts'))
  const maxAge = parseMaxAge(get('maxAge'))
  const chunkPart = body.get('chunk')

  if (
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(totalChunks) ||
    !filename ||
    !(chunkPart instanceof File)
  ) {
    throw invalidChunkUpload()
  }

  return uploadChunk(event, {
    uploadId,
    chunkIndex,
    totalChunks,
    filename,
    type,
    chunk: Buffer.from(await chunkPart.arrayBuffer()),
    path,
    isPrivate,
    parts,
    maxAge,
  })
})

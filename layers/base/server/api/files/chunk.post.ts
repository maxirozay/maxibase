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

  const get = (name: string) =>
    body
      .find((p) => p.name === name)
      ?.data.toString()
      .trim()

  const uploadId = get('uploadId')
  const chunkIndex = Number(get('chunkIndex'))
  const totalChunks = Number(get('totalChunks'))
  const filename = get('filename')
  const type = get('type') || 'application/octet-stream'
  const path = get('path') || 'files'
  const isPrivate = get('isPrivate') !== 'false'
  const parts = parseParts(get('parts'))
  const chunkPart = body.find((p) => p.name === 'chunk')

  if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || !filename || !chunkPart) {
    throw invalidChunkUpload()
  }

  return uploadChunk(event, {
    uploadId,
    chunkIndex,
    totalChunks,
    filename,
    type,
    chunk: chunkPart.data,
    path,
    isPrivate,
    parts,
  })
})

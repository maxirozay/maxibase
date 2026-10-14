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
  const parts = get('parts') ? JSON.parse(get('parts') || '[]') : []
  const chunkPart = body.find((p) => p.name === 'chunk')

  if (isNaN(chunkIndex) || isNaN(totalChunks) || !filename || !chunkPart) {
    throw createError({ status: 400, message: 'Invalid chunk upload' })
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

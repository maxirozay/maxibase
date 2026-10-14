export default defineEventHandler(async (event) => {
  const body = await readUploadBody(event, Number(useRuntimeConfig().public.files.maxSize))
  if (!body) {
    throw createError({ status: 400, message: 'No file uploaded' })
  }

  const pathPart = body.find((p) => p.name === 'path')
  const isPrivatePart = body.find((p) => p.name === 'isPrivate')
  const isPrivate = isPrivatePart ? isPrivatePart.data.toString() === 'true' : true
  const path = pathPart?.data.toString().trim()

  return await Promise.all(
    body.filter((p) => p.name === 'file').map((file) => uploadFile(event, file, path, isPrivate)),
  )
})

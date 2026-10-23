export default defineEventHandler(async (event) => {
  const body = await readUploadBody(event, Number(useRuntimeConfig().public.files.maxSize))
  if (!body) {
    throw createError({ status: 400, message: 'No file uploaded' })
  }

  const get = (name: string) => {
    const value = body.get(name)
    return typeof value === 'string' ? value.trim() : undefined
  }

  const isPrivate = body.has('isPrivate') ? get('isPrivate') === 'true' : true
  const path = get('path')
  const maxAge = parseMaxAge(get('maxAge'))

  return await Promise.all(
    body
      .getAll('file')
      .filter((file) => file instanceof File)
      .map((file) => uploadFile(event, file, path, isPrivate, maxAge)),
  )
})

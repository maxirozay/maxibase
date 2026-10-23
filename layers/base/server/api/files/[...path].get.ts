import { z } from 'zod'

const querySchema = z.object({
  isPrivate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  maxAge: z.coerce.number().int().min(0).optional(),
  // S3 refuses to presign a URL for longer than 7 days
  expireIn: z.coerce.number().int().positive().max(604800).optional(),
  redirect: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') || ''
  const {
    isPrivate = false,
    maxAge,
    expireIn,
    redirect,
  } = await getValidatedQuery(event, querySchema.parse)

  setHeader(event, 'Cache-Control', getCacheControl(isPrivate, maxAge))
  return getFile(event, decodePath(path), isPrivate, expireIn, redirect)
})

// h3 decodes the path but keeps %25 encoded, so a % in a name needs this second pass
function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    throw createError({ status: 400, message: 'Invalid path' }) // a % not followed by hex
  }
}

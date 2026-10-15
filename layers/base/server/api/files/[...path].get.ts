import { z } from 'zod'

const querySchema = z.object({
  isPrivate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  maxAge: z.coerce.number().int().min(0).optional(),
  // only-if-cached is left out, fetch throws on it outside same-origin mode
  serverCache: z.enum(['default', 'no-store', 'reload', 'no-cache', 'force-cache']).optional(),
  // S3 refuses to presign a URL for longer than 7 days
  expireIn: z.coerce.number().int().positive().max(604800).optional(),
  redirect: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})

export default defineEventHandler(async (event) => {
  const path = event.context.params?.path || ''
  const {
    isPrivate = false,
    maxAge,
    serverCache,
    expireIn,
    redirect,
  } = await getValidatedQuery(event, querySchema.parse)

  let cache = `public, max-age=${maxAge || 31536000}`
  if (maxAge === 0) {
    cache = 'no-store, no-cache'
  } else if (isPrivate) {
    cache = `private, max-age=${maxAge || 3600}`
  }
  setHeader(event, 'Cache-Control', cache)
  return getFile(event, decodePath(path), isPrivate, serverCache, expireIn, redirect)
})

// h3 decodes the path but keeps %25 encoded, so a % in a name needs this second pass
function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    throw createError({ status: 400, message: 'Invalid path' }) // a % not followed by hex
  }
}

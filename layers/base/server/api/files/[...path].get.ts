import { createError, defineEventHandler, getRouterParam, getValidatedQuery } from 'nuxt/server'
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
    isPrivate = true,
    maxAge,
    expireIn,
    redirect,
  } = await getValidatedQuery(event, querySchema.parse)

  event.res.headers.set('Cache-Control', getCacheControl(isPrivate, maxAge))
  return getFile(event, decodePath(path), { isPrivate, expireIn, redirect })
})

// The param comes still encoded, decoded here so a malformed % is a 400
function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    throw createError({ status: 400, message: 'Invalid path' }) // a % not followed by hex
  }
}

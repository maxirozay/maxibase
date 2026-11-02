import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

const bodySchema = z.object({
  path: z.string().min(1),
  isPrivate: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { path, isPrivate } = await readValidatedBody(event, bodySchema.parse)
  await deletePath(event, path, { isPrivate })
  return { success: true }
})

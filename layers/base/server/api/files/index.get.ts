import { z } from 'zod'

const querySchema = z.object({
  path: z.string().min(1),
  isPrivate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})

export default defineEventHandler(async (event) => {
  const { path, isPrivate = false } = await getValidatedQuery(event, querySchema.parse)
  return listFolder(event, path, isPrivate)
})

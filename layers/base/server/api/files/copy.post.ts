import { z } from 'zod'

const bodySchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
  isPrivate: z.boolean().optional(),
  deleteSrc: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { src, dest, isPrivate, deleteSrc } = await readValidatedBody(event, bodySchema.parse)
  await copyFiles(event, src, dest, isPrivate, deleteSrc)
  return { success: true }
})

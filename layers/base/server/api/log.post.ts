import z from 'zod'

const MAX_DATA_LENGTH = 10000

const bodySchema = z.object({
  summary: z.string().max(1000),
  data: z
    .unknown()
    .optional()
    .refine((v) => v === undefined || (JSON.stringify(v)?.length ?? 0) <= MAX_DATA_LENGTH, {
      message: 'data too large',
    }),
  origin: z.string().max(500).optional(),
  type: z.enum(['info', 'warn', 'error', 'debug']).catch('info').optional(),
})

export default defineEventHandler(async (event) => {
  const { summary, data, origin, type } = await readValidatedBody(event, bodySchema.parse)
  await log(summary, data, origin ? `client ${origin}` : 'client', type, event)
})

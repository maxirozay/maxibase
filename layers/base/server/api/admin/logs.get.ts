import z from 'zod'

const querySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  search: z.string().optional(),
  type: z.enum(logTypeValues).optional().catch(undefined),
  limit: z.coerce.number().int().positive().max(2000).default(200),
})

export default defineEventHandler(async (event) => {
  const { from, to, search, type, limit } = await getValidatedQuery(event, querySchema.parse)
  const text = prepareStringForSearch(search)

  const rows = await db.query.logs.findMany({
    where: {
      time: {
        gte: new Date(from),
        lte: new Date(to),
      },
      type: type ? { eq: type } : undefined,
      OR: text
        ? [
            { summary: { ilike: text } },
            { origin: { ilike: text } },
            { auth: { email: { ilike: text } } },
          ]
        : undefined,
    },
    orderBy: {
      time: 'desc',
    },
    limit: limit + 1,
    with: {
      auth: {
        columns: {
          email: true,
        },
      },
    },
  })

  return {
    logs: rows.slice(0, limit),
    hasMore: rows.length > limit,
    limit,
  }
})

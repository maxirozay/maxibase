import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { products } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const shop = await requireShopAdmin(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
  const body = await readValidatedBody(event, productSchema.parse)
  const [product] = await db
    .update(products)
    .set(body)
    .where(and(eq(products.id, id), eq(products.organizationId, shop.id)))
    .returning()
  if (!product) throw createError({ statusCode: 404, message: 'Product not found' })

  return product
})

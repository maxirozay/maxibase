import { products } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const shop = await requireShopAdmin(event)
  const body = await readValidatedBody(event, productSchema.parse)
  const [product] = await db
    .insert(products)
    .values({ ...body, organizationId: shop.id })
    .returning()

  return product
})

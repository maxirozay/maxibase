import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { products } from '#server/database/schema'

// orders keep a copy of their products, deleting one leaves them intact
export default defineEventHandler(async (event) => {
  const shop = await requireShopAdmin(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.uuid() }).parse)
  await db.delete(products).where(and(eq(products.id, id), eq(products.organizationId, shop.id)))
})

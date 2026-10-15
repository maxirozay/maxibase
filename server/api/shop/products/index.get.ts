export default defineEventHandler(async (event) => {
  const shop = await requireShopAdmin(event)
  return db.query.products.findMany({
    where: { organizationId: shop.id },
    orderBy: { name: 'asc' },
  })
})

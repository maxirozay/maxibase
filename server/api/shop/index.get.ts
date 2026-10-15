export default defineEventHandler(async (event) => {
  const shop = await getShop(event)
  const products = await db.query.products.findMany({
    columns: { id: true, name: true, description: true, image: true, price: true },
    where: { organizationId: shop.id, active: true },
    orderBy: { name: 'asc' },
  })

  return { name: shop.name, currency: shop.currency, products }
})

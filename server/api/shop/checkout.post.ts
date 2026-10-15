import { z } from 'zod'
import { orders } from '#server/database/schema'

const bodySchema = z.object({
  items: z
    .array(z.object({ productId: z.uuid(), quantity: z.int().min(1).max(99) }))
    .min(1)
    .max(50),
})

export default defineEventHandler(async (event) => {
  const { items } = await readValidatedBody(event, bodySchema.parse)
  const shop = await getShop(event)

  // prices come from the database, never from the client
  const products = await db.query.products.findMany({
    where: { organizationId: shop.id, active: true, id: { in: items.map((i) => i.productId) } },
  })
  const orderItems = items.map(({ productId, quantity }) => {
    const product = products.find((p) => p.id === productId)
    if (!product) throw createError({ statusCode: 400, message: 'Product unavailable' })
    return { productId, name: product.name, price: product.price, quantity }
  })
  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0)

  const xForwardedHost = useRuntimeConfig().rateLimit.trustedProxies > 0
  const { origin } = getRequestURL(event, { xForwardedHost, xForwardedProto: xForwardedHost })
  // the order is only saved once Stripe accepted the session
  const orderId = crypto.randomUUID()
  const session = await useStripe().checkout.sessions.create({
    mode: 'payment',
    client_reference_id: orderId,
    line_items: orderItems.map((i) => ({
      quantity: i.quantity,
      price_data: {
        currency: shop.currency,
        unit_amount: i.price,
        product_data: { name: i.name },
      },
    })),
    success_url: `${origin}/cart?order=paid`,
    cancel_url: `${origin}/cart`,
  })

  await db.insert(orders).values({
    id: orderId,
    organizationId: shop.id,
    items: orderItems,
    total,
    currency: shop.currency,
    stripeSessionId: session.id,
  })

  return { url: session.url }
})

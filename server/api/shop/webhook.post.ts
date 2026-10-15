import { eq } from 'drizzle-orm'
import { orders } from '#server/database/schema'

// Stripe calls it when a checkout completes, set the endpoint in the Stripe dashboard
export default defineEventHandler(async (event) => {
  const body = await readRawBody(event)
  const signature = getRequestHeader(event, 'stripe-signature')
  if (!body || !signature) throw createError({ statusCode: 400, message: 'Invalid request' })

  let stripeEvent
  try {
    stripeEvent = await useStripe().webhooks.constructEventAsync(
      body,
      signature,
      useRuntimeConfig().stripe.webhookSecret,
    )
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid signature' })
  }

  // async payment methods complete first and pay later
  if (
    stripeEvent.type === 'checkout.session.completed' ||
    stripeEvent.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = stripeEvent.data.object
    if (session.payment_status !== 'paid') return { received: true }

    await db
      .update(orders)
      .set({ status: 'paid', email: session.customer_details?.email })
      .where(eq(orders.stripeSessionId, session.id))
  }

  return { received: true }
})

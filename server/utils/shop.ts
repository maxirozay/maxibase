import type { H3Event } from 'h3'
import Stripe from 'stripe'
import { z } from 'zod'

export function getShopDomain(event: H3Event) {
  const xForwardedHost = useRuntimeConfig().rateLimit.trustedProxies > 0
  return getRequestHost(event, { xForwardedHost }).replace(/:\d+$/, '').toLowerCase()
}

export async function getShop(event: H3Event) {
  const shop = await db.query.organizations.findFirst({
    where: { domain: getShopDomain(event) },
  })
  if (shop) return shop

  // a single shop is shown on any domain
  const shops = await db.query.organizations.findMany({ limit: 2 })
  if (shops.length === 1) return shops[0]!

  throw createError({ statusCode: 404, message: 'Shop not found' })
}

let stripe: Stripe | undefined
export function useStripe() {
  stripe ??= new Stripe(useRuntimeConfig().stripe.secretKey)
  return stripe
}

// app admins and the admins of the current domain's organization manage its shop
export async function requireShopAdmin(event: H3Event) {
  const shop = await getShop(event)
  const { user } = await requireUserSession(event)
  if (user.role !== 'admin') await isOrganizationAdmin(event, shop.id)

  return shop
}

export const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  image: z.string().trim().max(2000).nullish(),
  price: z.int().min(1).max(100_000_000), // in the currency's smallest unit
  active: z.boolean(),
})

import type { H3Event } from 'h3'

export interface RateLimitRule {
  limit: number // max requests per window
  window: number // window duration in seconds
}

interface RateLimitEntry {
  count: number
  resetAt: number
  bannedUntil: number
}

const entries = new Map<string, RateLimitEntry>()

const SWEEP_INTERVAL = 10 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of entries) {
    if (now > entry.resetAt && now > entry.bannedUntil) entries.delete(key)
  }
}, SWEEP_INTERVAL).unref?.()

async function getId(event: H3Event): Promise<string> {
  const { user } = await getUserSession(event)
  if (user) return user.id
  return getClientIP(event)
}

export async function enforceRateLimit(
  event: H3Event,
  route: string,
  rule: RateLimitRule,
  id?: string,
) {
  const config = useRuntimeConfig()
  id ??= await getId(event)
  const key = `${route}:${id}`
  const now = Date.now()

  let entry = entries.get(key)

  if (entry && entry.bannedUntil > now) {
    throw tooManyRequests(event, entry.bannedUntil - now)
  }

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + rule.window * 1000, bannedUntil: 0 }
    entries.set(key, entry)
  }

  entry.count++
  if (entry.count <= rule.limit) return

  if (entry.count === rule.limit * config.rateLimit.banMultiplier) {
    entry.bannedUntil = now + config.rateLimit.banSeconds * 1000
    await log('Rate limit ban', undefined, route, 'security', event).catch(() => {})
    throw tooManyRequests(event, entry.bannedUntil - now)
  }

  if (entry.count === rule.limit + 1) {
    await log('Rate limit exceeded', undefined, route, 'security', event).catch(() => {})
  }

  throw tooManyRequests(event, entry.resetAt - now)
}

function tooManyRequests(event: H3Event, retryAfterMS: number) {
  setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMS / 1000))
  return createError({
    status: 429,
    message: 'Too many requests',
  })
}

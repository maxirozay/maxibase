import { createError } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'

export async function requireAdmin(event: RequestEvent) {
  const session = await requireUserSession(event)
  if (session.user.role === 'admin') return session

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

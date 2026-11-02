import type { H3Event } from 'h3'

export async function requireAdmin(event: H3Event) {
  const session = await requireUserSession(event)
  if (session.user.role === 'admin') return session

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

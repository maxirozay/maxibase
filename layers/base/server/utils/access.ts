import type { H3Event } from 'h3'

export async function isAdmin(event: H3Event) {
  const { user } = await requireUserSession(event)
  if (user.role === 'admin') return true

  throw createError({ statusCode: 403, message: 'Insufficient permissions' })
}

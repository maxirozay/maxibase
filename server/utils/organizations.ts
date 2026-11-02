import { createError } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'

export async function requireOrganizationMember(event: RequestEvent, organizationId: string) {
  const { user } = await requireUserSession(event)
  const membership = await db.query.organizationMembers.findFirst({
    where: {
      userId: user.id,
      organizationId,
    },
  })
  if (!membership) {
    throw createError({ status: 403, message: 'Insufficient permissions' })
  }

  return membership
}

export async function requireOrganizationAdmin(event: RequestEvent, organizationId: string) {
  const membership = await requireOrganizationMember(event, organizationId)
  if (membership.role === 'admin') return membership

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

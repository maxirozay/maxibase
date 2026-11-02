import type { H3Event } from 'h3'

export async function requireOrganizationMember(event: H3Event, organizationId: string) {
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

export async function requireOrganizationAdmin(event: H3Event, organizationId: string) {
  const membership = await requireOrganizationMember(event, organizationId)
  if (membership.role === 'admin') return membership

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

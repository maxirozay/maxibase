export async function checkFileAccess(event: any, path: string) {
  const { user } = await requireUserSession(event)
  if (!user) throw createError({ status: 401, message: 'Unauthorized' })
  const root = `u/${user.id}`
  if (path.startsWith(root) && (path[root.length] === '/' || path.length === root.length)) {
    return true
  }

  if (path.startsWith('o/')) {
    const orgId = path.substring(2).replace(/\/.*/, '')
    if (await isOrganizationAdmin(event, orgId)) return true
  } else if (user.role === 'admin') return true

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

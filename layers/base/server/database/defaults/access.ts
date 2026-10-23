import type { H3Event } from 'h3'

// Users reach their own folder u/{id}, admins every folder
export async function checkFileAccess(event: H3Event, path: string) {
  const { user } = await requireUserSession(event)
  if (!user) throw createError({ status: 401, message: 'Unauthorized' })
  const root = `u/${user.id}`
  if (path.startsWith(root) && (path[root.length] === '/' || path.length === root.length)) {
    return true
  }
  if (user.role === 'admin') return true

  throw createError({ status: 403, message: 'Insufficient permissions' })
}

import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  if (!event.url.pathname.startsWith('/api/admin/')) return
  await requireAdmin(event)
})

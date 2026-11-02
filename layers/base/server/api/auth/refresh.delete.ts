import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  const session = await requireRecentAuth(event)
  await revokeAllUserTokens(session.user.id)
})

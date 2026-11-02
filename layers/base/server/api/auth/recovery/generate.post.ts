import { createError, defineEventHandler } from 'nuxt/server'

export default defineEventHandler(async (event) => {
  await requireRecentAuth(event)
  const user = await requireAuthUser(event, { withCredentials: true })

  if (!user.totp && !user.credentials!.length) {
    throw createError({ status: 400, message: 'Set up a second factor first.' })
  }

  const codes = await generateRecoveryCodes(user.id)
  await log('Recovery codes generated', { type: 'security', event })

  return { codes }
})

import { defineEventHandler } from 'nuxt/server'
import { generateSecret } from 'otplib'

export default defineEventHandler(async (event) => {
  await requireRecentAuth(event)
  return { secret: generateSecret() }
})

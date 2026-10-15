import { eq } from 'drizzle-orm'
import { auth } from '#server/database/schema'
import { z } from 'zod'
import { verify } from 'otplib'

const bodySchema = z.object({
  secret: z.string().min(32),
  token: z.string().length(6),
})

export default defineEventHandler(async (event) => {
  const { secret, token } = await readValidatedBody(event, bodySchema.parse)

  const { user } = await requireRecentAuth(event)

  if ((await verify({ secret, token })).valid) {
    await db.update(auth).set({ totp: secret }).where(eq(auth.id, user.id))
    await setSession(event, user, false) // refresh requiresMfaSetup
  } else throw createError({ status: 400, message: 'Invalid code.' })
})

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authUsers } from '#server/database/schema'
import { verifyOTP } from '../otp/verify.post'
import { emailChangeKey } from './get.post'

const bodySchema = z.object({
  email: emailSchema,
  otp: z.string().length(6),
  locale: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { email, otp, locale = 'en' } = await readValidatedBody(event, bodySchema.parse)
  await requireRecentAuth(event)
  const user = await requireAuthUser(event)
  const previousEmail = user.email

  await verifyOTP(emailChangeKey(user.id, email), otp)

  const updated = await db
    .update(authUsers)
    .set({ email })
    .where(eq(authUsers.id, user.id))
    .returning()
    .catch((error: any) => {
      // 23505: unique violation
      if (error?.cause?.code === '23505' || error?.code === '23505') {
        throw createError({ status: 409, message: 'This email address is already in use.' })
      }
      throw error
    })

  if (!updated[0]) {
    throw createError({ status: 500, message: 'User update failed' })
  }

  await log('Email changed', {
    data: { from: previousEmail, to: email },
    type: 'security',
    event,
  })

  if (previousEmail) {
    await sendEmailTemplate('emailChanged', {
      to: previousEmail,
      locale,
      params: { email },
    }).catch(() => {})
  }

  await revokeAllUserTokens(user.id)
  await setSession(event, updated[0])
})

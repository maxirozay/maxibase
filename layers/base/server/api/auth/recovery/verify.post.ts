import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useKV } from 'nitro/kv'
import { z } from 'zod'
import { verifyFirstFactor } from '../totp/verify.post'

export default defineEventHandler(async (event) => {
  const {
    email,
    password,
    otp,
    code,
    locale = 'en',
  } = await readValidatedBody(
    event,
    z.object({
      email: emailSchema,
      password: passwordSchema().optional(),
      otp: otpSchema.optional(),
      code: z.string().min(10).max(16),
      locale: z.string().optional(),
    }).parse,
  )

  const user = await verifyFirstFactor(event, email, { password, otp })
  if (!user) throw createError({ status: 400, message: 'Invalid recovery code.' })

  await enforceRateLimit(event, 'recovery', { limit: 5, window: 900 }, user.id)

  const remaining = await consumeRecoveryCode(user.id, code)
  if (remaining === null) throw createError({ status: 400, message: 'Invalid recovery code.' })

  if (otp) await useKV('auth').removeItem(email)
  const session = await setSession(event, user)

  await log('Recovery code used', { data: { remaining }, type: 'security', event })
  await sendEmailTemplate('recoveryCodeUsed', {
    to: user.email!,
    locale,
    params: { remaining },
  }).catch(() => {})

  return session
})

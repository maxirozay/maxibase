import { z } from 'zod'
import { verify } from 'otplib'
import type { H3Event } from 'h3'
import { verifyOTP } from '../otp/verify.post'

export async function verifyFirstFactor(
  event: H3Event,
  email: string,
  { password, otp }: { password?: string; otp?: string },
) {
  if (!otp && !password) {
    throw createError({
      status: 400,
      message: 'Missing required fields',
    })
  }

  const user = await getAuth(event, email).catch((error: any) => {
    if (error?.statusCode === 404) return null
    throw error
  })

  if (otp) await verifyOTP(email, otp, false)
  else if (!user?.password) {
    await hashPassword(password!)
    throw createError({ status: 400, message: 'Invalid password.' })
  } else if (!(await verifyPassword(user.password, password!))) {
    throw createError({ status: 400, message: 'Invalid password.' })
  }

  return user
}

export default defineEventHandler(async (event) => {
  const { email, password, otp, token } = await readValidatedBody(
    event,
    z.object({
      email: emailSchema,
      password: passwordSchema().optional(),
      otp: otpSchema.optional(),
      token: z.string().length(6),
    }).parse,
  )

  const user = await verifyFirstFactor(event, email, { password, otp })

  if (!user?.totp) {
    throw createError({ status: 400, message: 'TOTP is not enabled.' })
  }

  await enforceRateLimit(event, 'totp', { limit: 5, window: 900 }, user.id)

  if ((await verify({ secret: user.totp, token })).valid) {
    if (otp) await useStorage('auth').removeItem(email)
    await setSession(event, user)
  } else throw createError({ status: 400, message: 'Invalid TOTP.' })
})

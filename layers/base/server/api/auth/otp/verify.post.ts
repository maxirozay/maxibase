import { z } from 'zod'
import type { OTP } from './get.post'

const bodySchema = z.object({
  email: emailSchema,
  otp: z.string().length(6).or(z.string().min(32)),
})

export default defineEventHandler(async (event) => {
  const { email, otp } = await readValidatedBody(event, bodySchema.parse)
  if (!email || !otp) {
    throw createError({
      status: 400,
      message: 'Email and OTP are required',
    })
  }
  await verifyOTP(email, otp)

  const session = await getUserSession(event)
  const user = await getAuth(event, email).catch((error) => {
    if (error.statusCode !== 404) throw error
    if (session?.user?.isAnonymous) return setAuth({ id: session.user.id, email })
    if (useRuntimeConfig().autoSignup) return createAuth({ email })
    throw error
  })
  if (user.totp) {
    throw createError({
      status: 401,
      message: 'TOTP required',
    })
  }
  return setSession(event, user)
})

const MAX_OTP_ATTEMPTS = 3

export async function verifyOTP(email: string, otp: string): Promise<void> {
  const storage = useStorage('auth')
  const record = await storage.getItem<OTP>(email)
  if (!record) {
    throw createError({ status: 400, message: 'Request a new OTP.' })
  }
  if (Date.now() > record.sentAt! + 5 * 60 * 1000 || record.attempts >= MAX_OTP_ATTEMPTS) {
    await storage.removeItem(email)
    throw createError({ status: 400, message: 'Request a new OTP.' })
  }

  record.attempts++
  await storage.setItem(email, record)

  const hash = otp.length > 6 ? record.token : record.otp
  if (!hash || !(await verifyPassword(hash, otp))) {
    throw createError({ status: 400, message: 'Invalid OTP.' })
  }
  await storage.removeItem(email)
}

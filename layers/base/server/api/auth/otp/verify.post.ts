import { z } from 'zod'
import type { H3Event } from 'h3'
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

  const existing = await getAuth(event, email, true).catch((error) => {
    if (error.statusCode !== 404) throw error
    return null
  })
  if (existing) requireSecondFactor(existing)

  await verifyOTP(email, otp)

  const user = existing ?? (await signUp(event, email))
  requireSecondFactor(user) // an anonymous account can already have a TOTP
  return setSession(event, user)
})

async function signUp(event: H3Event, email: string) {
  const session = await getUserSession(event)
  if (session?.user?.isAnonymous) return setAuth({ id: session.user.id, email })
  if (useRuntimeConfig().autoSignup) return createAuth({ email })
  throw createError({ status: 404, message: 'User not found' })
}

const MAX_OTP_ATTEMPTS = 3

const verifying = new Set<string>()

export async function verifyOTP(email: string, otp: string, consume = true): Promise<void> {
  if (verifying.has(email)) {
    throw createError({ status: 429, message: 'Verification already in progress.' })
  }
  verifying.add(email)
  try {
    await checkOTP(email, otp, consume)
  } finally {
    verifying.delete(email)
  }
}

async function checkOTP(email: string, otp: string, consume: boolean) {
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
  if (consume) await storage.removeItem(email)
}

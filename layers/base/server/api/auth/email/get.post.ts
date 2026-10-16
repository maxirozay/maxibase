import { z } from 'zod'
import { generateOTP, type OTP } from '../otp/get.post'

const bodySchema = z.object({
  email: emailSchema,
  locale: z.string().optional(),
})

export function emailChangeKey(userId: string, email: string) {
  return `change:${userId}:${email.trim().toLowerCase()}`
}

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { email, locale = 'en' } = await readValidatedBody(event, bodySchema.parse)
  const user = await getAuth(event)

  if (user.email === email) {
    throw createError({ status: 400, message: 'This is already your email address.' })
  }

  const storage = useStorage('auth')
  const key = emailChangeKey(user.id, email)
  const record = await storage.getItem<OTP>(key)
  if (record && Date.now() < record.sentAt + 60000) {
    throw createError({ status: 400, message: 'Wait a minute before requesting a new code.' })
  }

  const otp = generateOTP()
  await storage.setItem(key, {
    otp: await hashPassword(otp),
    attempts: 0,
    sentAt: Date.now(),
  })

  try {
    await sendEmailTemplate('emailChange', locale, { otp }, email)
  } catch (error) {
    await storage.removeItem(key)
    throw createError({
      status: 502,
      message: 'Could not send the email. Please try again.',
      cause: error,
    })
  }
})

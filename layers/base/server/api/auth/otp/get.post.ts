import { z } from 'zod'
import crypto from 'crypto'

const bodySchema = z.object({
  email: emailSchema,
  locale: z.string().optional(),
  goto: z.string().optional(),
  path: z.string().optional(),
})

export interface OTP {
  otp: string
  token?: string // magic link only, absent on flows that issue no link
  attempts: number
  sentAt: number
}

export default defineEventHandler(async (event) => {
  const {
    email,
    locale = 'en',
    goto,
    path = 'signin',
  } = await readValidatedBody(event, bodySchema.parse)

  const storage = useStorage('auth')
  const record = await storage.getItem<OTP>(email)
  if (record && Date.now() < record.sentAt! + 60000) {
    throw createError({ status: 400, message: 'Wait a minute before requesting a new OTP.' })
  }

  const baseUrl = useRuntimeConfig().public.url.replace(/\/+$/, '')
  const magicLinkPath = safePath(path.startsWith('/') ? path : `/${path}`, '/signin')
  const linkGoto = goto ? safePath(goto, '') : ''

  const otp = generateOTP()
  const token = crypto.randomBytes(32).toString('base64url')
  await storage.setItem(email, {
    otp: await hashPassword(otp),
    attempts: 0,
    sentAt: Date.now(),
    token: await hashPassword(token),
  })

  try {
    return await sendEmailTemplate(
      'otp',
      locale,
      {
        otp,
        magicLink: `${baseUrl}${magicLinkPath}?email=${encodeURIComponent(email)}&token=${token}${linkGoto ? `&goto=${encodeURIComponent(linkGoto)}` : ''}`,
      },
      email,
    )
  } catch (error) {
    await storage.removeItem(email)
    throw createError({
      status: 502,
      message: 'Could not send the email. Please try again.',
      cause: error,
    })
  }
})

export function generateOTP(length = 6): string {
  const otp = crypto.randomInt(Math.pow(10, length - 1), Math.pow(10, length))
  return otp.toString()
}

import { z } from 'zod'

const bodySchema = z.object({
  email: emailSchema,
})

export default defineEventHandler(async (event) => {
  const { email } = await readValidatedBody(event, bodySchema.parse)

  const user = await getAuth(event, email, true).catch((error: any) => {
    if (error?.statusCode === 404) return null
    throw error
  })
  if (!user) {
    return {
      hasOTP: true,
      hasPassword: false,
      hasTOTP: false,
      hasPasskey: false,
    }
  }

  return {
    hasOTP: true,
    hasPassword: !!user.password,
    hasTOTP: !!user.totp,
    hasPasskey: user.credentials!.length > 0,
  }
})

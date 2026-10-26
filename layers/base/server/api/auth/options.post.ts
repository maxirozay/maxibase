import { z } from 'zod'

const bodySchema = z.object({
  email: emailSchema,
})

export default defineEventHandler(async (event) => {
  const { email } = await readValidatedBody(event, bodySchema.parse)

  try {
    const user = await getAuth(event, email, true)
    return {
      hasOTP: true,
      hasPassword: !!user.password,
      hasTOTP: !!user.totp,
      hasPasskey: user.credentials!.length > 0,
      hasRecoveryCodes: (await countRecoveryCodes(user.id)) > 0,
    }
  } catch {
    return {
      hasOTP: true,
      hasPassword: false,
      hasTOTP: false,
      hasPasskey: false,
      hasRecoveryCodes: false,
    }
  }
})

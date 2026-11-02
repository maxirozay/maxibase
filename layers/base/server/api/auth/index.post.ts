import { eq } from 'drizzle-orm/sql/expressions/conditions'
import { z } from 'zod'
import { authUsers } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const { password, locale = 'en' } = await readValidatedBody(
    event,
    z.object({
      password: passwordSchema(),
      locale: z.string().optional(),
    }).parse,
  )
  const { user } = await requireRecentAuth(event)
  await db
    .update(authUsers)
    .set({
      password: await hashPassword(password),
    })
    .where(eq(authUsers.id, user.id))

  await log('Password changed', { type: 'security', event })

  if (user.email) {
    await sendEmailTemplate('passwordChanged', { to: user.email, locale }).catch(() => {})
  }
})

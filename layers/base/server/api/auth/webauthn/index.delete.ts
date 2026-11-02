import { createError, defineEventHandler, readValidatedBody, useRuntimeConfig } from 'nuxt/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { authUsers, authCredentials } from '#server/database/schema'

const bodySchema = z.object({
  credentialId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const { credentialId } = await readValidatedBody(event, bodySchema.parse)
  const session = await requireRecentAuth(event)
  const userId = session.user.id

  if (!useRuntimeConfig().forceMfa) {
    await db
      .delete(authCredentials)
      .where(and(eq(authCredentials.id, credentialId), eq(authCredentials.userId, userId)))
    return
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ totp: authUsers.totp })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .for('update')
    if (!locked) {
      throw createError({ status: 404, message: 'User not found' })
    }

    const remaining = await tx
      .select({ id: authCredentials.id })
      .from(authCredentials)
      .where(eq(authCredentials.userId, userId))
    if (!locked.totp && remaining.length <= 1) {
      throw createError({ status: 400, message: 'Keep at least one second factor.' })
    }

    await tx
      .delete(authCredentials)
      .where(and(eq(authCredentials.id, credentialId), eq(authCredentials.userId, userId)))
  })
})

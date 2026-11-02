import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { authCredentials } from '#server/database/schema'

const bodySchema = z.object({
  name: z.string().min(1).max(32),
  credentialId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const { name, credentialId } = await readValidatedBody(event, bodySchema.parse)
  const session = await requireRecentAuth(event)
  await db
    .update(authCredentials)
    .set({ name })
    .where(and(eq(authCredentials.id, credentialId), eq(authCredentials.userId, session.user.id)))
})

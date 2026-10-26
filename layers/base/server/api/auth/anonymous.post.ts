import { auth } from '#server/database/schema'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const session = await getUserSession(event)
  if (session?.user || !config.public.anonymousSignup) {
    throw createError({
      status: 403,
      message: 'Anonymous signup not allowed',
    })
  }
  if (config.forceMfa) {
    throw createError({
      status: 403,
      message: 'Anonymous signup not allowed when MFA is required',
    })
  }

  const insertedUsers = await db
    .insert(auth)
    .values({ locale: useLocaleServerMiddleware(event).current })
    .returning()

  if (!insertedUsers[0]) {
    throw createError({
      status: 500,
      message: 'Anonymous user creation failed',
    })
  }

  const user = insertedUsers[0]

  return setSession(event, user)
})

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

  return setSession(event, await createAuthUser(event))
})

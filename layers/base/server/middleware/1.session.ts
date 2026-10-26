export default defineEventHandler(async (event) => {
  const existingToken = getCookie(event, 'refresh_token')
  if (!existingToken) return

  const session = await getUserSession(event)
  if (session.user) return

  try {
    const { user } = await verifyRefreshToken(event)

    const sessionData = await setSession(event, user, false)
    session.user = sessionData?.user // to update the session on SSR
    await updateLastActive(user.id)
  } catch {}
})

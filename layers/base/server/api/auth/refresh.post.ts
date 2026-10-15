export default defineEventHandler(async (event) => {
  const { user } = await verifyRefreshToken(event)
  await revokeRefreshToken(getCookie(event, 'refresh_token')!) // verified above, so it is set
  await createRefreshToken(user.id, event)
})

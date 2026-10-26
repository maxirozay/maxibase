export default defineEventHandler(async (event) => {
  await requireRecentAuth(event)
  const user = await getAuth(event, undefined, true)

  if (!user.totp && !user.credentials!.length) {
    throw createError({ status: 400, message: 'Set up a second factor first.' })
  }

  const codes = await generateRecoveryCodes(user.id)
  await log('Recovery codes generated', undefined, undefined, 'security', event)

  return { codes }
})

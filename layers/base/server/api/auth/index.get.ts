export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const user = await getAuth(event, undefined, true)
  return {
    credentials: user.credentials!.map(({ id, name }) => ({ id, name })),
    hasPassword: !!user.password,
    hasTOTP: !!user.totp,
    recoveryCodes: await countRecoveryCodes(user.id),
    forceMfa: useRuntimeConfig().forceMfa,
  }
})

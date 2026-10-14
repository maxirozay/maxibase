export default defineOAuthMicrosoftEventHandler({
  config: {
    scope: ['openid', 'email', 'User.Read'],
  },
  async onSuccess(event, { tokens }) {
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
    if (!claims.email || claims.xms_edov !== true) {
      throw createError({
        status: 401,
        message: 'This Microsoft account has no verified email address',
      })
    }

    const auth = await getAuth(event, claims.email).catch((error) => {
      const config = useRuntimeConfig()

      if (error.statusCode === 404 && config.autoSignup) {
        return createAuth({ email: claims.email })
      }
      throw error
    })
    await setSession(event, auth)
    return sendRedirect(event, '/')
  },
})

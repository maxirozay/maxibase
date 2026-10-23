// a session flagged requiresMfaSetup is only allowed to enroll a second factor
const ENROLLMENT_ROUTES = [
  '/api/_auth/session', // read and clear the session
  '/api/auth', // GET only, lists the credentials shown on /user/auth
  '/api/auth/webauthn/register',
  '/api/auth/totp/generate',
  '/api/auth/totp/confirm',
  '/api/auth/refresh', // DELETE, sign out from all devices
  '/api/log', // client error reporting, rate limited
]

export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().forceMfa) return
  if (!event.path.startsWith('/api/')) return

  const session = await getUserSession(event)
  if (!session.user?.email) return

  let { requiresMfaSetup } = session.user
  if (requiresMfaSetup === undefined) {
    requiresMfaSetup = (await mfaSetupFlag(session.user))?.requiresMfaSetup ?? false
    await replaceUserSession(event, {
      ...session,
      user: { ...session.user, requiresMfaSetup },
    })
  }
  if (!requiresMfaSetup) return

  const path = event.path.split('?')[0]!
  if (path.startsWith('/api/auth/otp/') || path === '/api/auth/password') return // re-authentication
  if (ENROLLMENT_ROUTES.includes(path) && !(path === '/api/auth' && !isMethod(event, 'GET'))) return

  throw createError({ status: 403, message: 'MFA setup required' })
})

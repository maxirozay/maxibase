import {
  createError,
  defineEventHandler,
  getQuery,
  sendRedirect,
  useRuntimeConfig,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'

const scope = ['openid', 'email', 'User.Read']

async function onSuccess(event: RequestEvent, { tokens }: { tokens: any }) {
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
  if (!claims.email || ![true, '1'].includes(claims.xms_edov)) {
    throw createError({
      status: 401,
      message: 'This Microsoft account has no verified email address',
    })
  }

  const user =
    (await findAuthUserByEmail(claims.email)) ??
    (useRuntimeConfig().autoSignup ? await createAuthUser(event, { email: claims.email }) : null)
  if (!user) throw createError({ status: 404, message: 'User not found' })
  await setSession(event, user)
  return sendRedirect(event, '/')
}

const signIn = defineOAuthMicrosoftEventHandler({ config: { scope }, onSuccess })
const selectAccount = defineOAuthMicrosoftEventHandler({
  config: { scope, authorizationParams: { prompt: 'select_account' } },
  onSuccess,
})

export default defineEventHandler((event) =>
  getQuery(event).prompt === 'select_account' ? selectAccount(event) : signIn(event),
)

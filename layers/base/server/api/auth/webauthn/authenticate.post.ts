import { createError } from 'nuxt/server'
import { useKV } from 'nitro/kv'
import { eq } from 'drizzle-orm'
import { authUsers, authCredentials } from '#server/database/schema'

export default defineWebAuthnAuthenticateEventHandler({
  async storeChallenge(event, challenge, attemptId) {
    await useKV('auth').setItem(`attempt:${attemptId}`, challenge)
  },
  async getChallenge(event, attemptId) {
    const challenge = await useKV('auth').getItem(`attempt:${attemptId}`)

    await useKV('auth').removeItem(`attempt:${attemptId}`)

    if (!challenge) throw createError({ status: 400, message: 'Challenge expired' })

    return challenge as string
  },
  getOptions() {
    return { userVerification: passkeyUserVerification() }
  },
  async allowCredentials(event, userName) {
    const user = await findAuthUserByEmail(userName, { withCredentials: true })
    if (!user) throw createError({ status: 404, message: 'User not found' })
    return (user as any).credentials || []
  },
  async getCredential(event, credentialId) {
    const credential = await db.query.authCredentials.findFirst({
      where: {
        id: credentialId,
      },
    })

    if (!credential) throw createError({ status: 400, message: 'Credential not found' })
    return credential as any
  },
  async onSuccess(event, { credential, authenticationInfo }) {
    requireUserVerification(authenticationInfo.userVerified)

    // the next assertion must report a higher counter, which exposes a cloned authenticator
    await db
      .update(authCredentials)
      .set({ counter: authenticationInfo.newCounter })
      .where(eq(authCredentials.id, credential.id))

    const user = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, credential.userId as string))
      .then((result) => result[0])
    await setSession(event, user!)
  },
})

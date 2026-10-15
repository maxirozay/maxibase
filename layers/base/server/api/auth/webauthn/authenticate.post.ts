import { eq } from 'drizzle-orm'
import { auth, credentials } from '#server/database/schema'

export default defineWebAuthnAuthenticateEventHandler({
  async storeChallenge(event, challenge, attemptId) {
    await useStorage('auth').setItem(`attempt:${attemptId}`, challenge)
  },
  async getChallenge(event, attemptId) {
    const challenge = await useStorage('auth').getItem(`attempt:${attemptId}`)

    await useStorage('auth').removeItem(`attempt:${attemptId}`)

    if (!challenge) throw createError({ status: 400, message: 'Challenge expired' })

    return challenge as string
  },
  async allowCredentials(event, userName) {
    const user = await getAuth(event, userName, true)
    return (user as any).credentials || []
  },
  async getCredential(event, credentialId) {
    const credential = await db.query.credentials.findFirst({
      where: {
        id: credentialId,
      },
    })

    if (!credential) throw createError({ status: 400, message: 'Credential not found' })
    return credential as any
  },
  async onSuccess(event, { credential, authenticationInfo }) {
    // the next assertion must report a higher counter, which exposes a cloned authenticator
    await db
      .update(credentials)
      .set({ counter: authenticationInfo.newCounter })
      .where(eq(credentials.id, credential.id))

    const user = await db
      .select()
      .from(auth)
      .where(eq(auth.id, credential.userId as string))
      .then((result) => result[0])
    await setSession(event, user!)
  },
})

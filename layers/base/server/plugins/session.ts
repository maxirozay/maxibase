import { deleteCookie, getCookie } from 'nuxt/server'
import { definePlugin } from 'nitro'

export default definePlugin(() => {
  sessionHooks.hook('clear', async (session, event) => {
    const refreshToken = getCookie(event, 'refresh_token')
    if (refreshToken) {
      deleteCookie(event, 'refresh_token')
      await revokeRefreshToken(refreshToken)
    }
  })
})

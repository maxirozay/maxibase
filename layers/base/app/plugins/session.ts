import type { FetchError } from 'ofetch'

export default defineNuxtPlugin(async () => {
  if (import.meta.server) return
  const { session, clear } = useUserSession()
  if (!session.value?.user) return

  const rotate = async () => {
    const lastRefreshed = parseInt(localStorage.getItem('rotate-token-at') || '0')
    if (lastRefreshed) {
      const refreshAfter = lastRefreshed + useRuntimeConfig().public.refreshToken.rotateAfter * 1000
      const { expiresAt } = session.value!
      if ((expiresAt !== undefined && expiresAt < Date.now()) || refreshAfter > Date.now()) return
      try {
        await $fetch('/api/auth/refresh', { method: 'POST' })
      } catch (error) {
        if ((error as FetchError).response?.status !== 401) return
        await clear()
        return
      }
    }
    localStorage.setItem('rotate-token-at', Date.now().toString())
  }

  // Tabs restored together would all send the same token: the first one rotates it and the
  // 401 of the others deletes the cookie it just got. One tab rotates, the others share its cookie.
  if (!navigator.locks) return rotate()
  await navigator.locks.request('rotate-token', { ifAvailable: true }, (lock) => lock && rotate())
})

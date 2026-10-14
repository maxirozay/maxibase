export const useAppStore = defineStore('app', () => {
  const isLoading = ref(false)
  const notifications = ref(
    [] as {
      id: number
      message: string
      type: 'error' | 'danger' | 'success'
      isSticky: boolean
      params?: Record<string, string | number>
    }[],
  )
  const confirmation = ref<{
    message?: string
    resolve: (value?: any) => any
    reject: (value?: any) => any
  } | null>(null)

  const { session } = useUserSession()
  const authPromise = ref()

  function confirm(message?: string) {
    return new Promise((resolve, reject) => {
      confirmation.value = {
        message,
        resolve,
        reject,
      }
    }).finally(() => {
      confirmation.value = null
    })
  }

  async function checkAuth(): Promise<boolean> {
    const reverifyAfter = useRuntimeConfig().public.recentAuth.maxAge * 1000
    if (Date.now() - (session.value?.authenticatedAt ?? 0) < reverifyAfter) {
      return true
    }
    return new Promise<boolean>((resolve) => {
      authPromise.value = { resolve }
    }).finally(() => {
      authPromise.value = null
    })
  }

  function setLoading(state: boolean) {
    isLoading.value = state
  }

  let lastNotificationId = 0

  function notify(
    message: string,
    type: 'success' | 'error' = 'success',
    isSticky = false,
    params?: Record<string, string | number>,
  ) {
    if (!message) return
    const id = ++lastNotificationId
    notifications.value.push({ id, message: handleZodError(message), type, isSticky, params })

    if (!isSticky) {
      setTimeout(() => removeNotification(id), 5000)
    }
  }

  function handleZodError(message: string) {
    try {
      if (message[0] === '[') {
        const parsed = JSON.parse(message)
        if (Array.isArray(parsed)) {
          return parsed[0].message
        }
      }
    } catch {
      return message
    }
    return message
  }

  function removeNotification(id: number) {
    notifications.value = notifications.value.filter((n) => n.id !== id)
  }

  return {
    isLoading,
    notifications,
    confirmation,
    confirm,
    setLoading,
    notify,
    removeNotification,
    authPromise,
    checkAuth,
  }
})

export default defineNuxtRouteMiddleware((to) => {
  const { user } = useUserSession()

  if (!user.value) {
    const redirectUrl =
      '/signin' + (to.fullPath !== '/' ? '?goto=' + encodeURIComponent(to.fullPath) : '')
    return navigateTo(redirectUrl, { replace: true })
  } else if (user.value.role !== 'admin') {
    return createError({
      status: 403,
      statusText: 'Forbidden',
      message: 'You do not have permission to access this page.',
    })
  }
})

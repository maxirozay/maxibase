import type { RateLimitRule } from '../utils/rateLimit'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.rateLimit.enabled) return

  const path = event.path.split('?')[0]!
  const routes = config.rateLimit.routes as Record<string, RateLimitRule>

  let matchedRoute = ''
  let matchedRule: RateLimitRule | undefined
  for (const [route, rule] of Object.entries(routes)) {
    if ((path === route || path.startsWith(route + '/')) && route.length > matchedRoute.length) {
      matchedRoute = route
      matchedRule = rule
    }
  }
  if (!matchedRule) return

  await enforceRateLimit(event, matchedRoute, matchedRule)
})

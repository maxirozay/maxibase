import type { H3Event } from 'h3'

export function getClientIP(event: H3Event): string {
  const { trustedProxies } = useRuntimeConfig().rateLimit

  // A client can send any x-forwarded-for it likes, so only the entries appended by our own
  // proxies can be trusted. Those are the rightmost ones: count back past them to the real client.
  if (trustedProxies > 0) {
    const forwarded = (getRequestHeader(event, 'x-forwarded-for') || '').split(',')
    const clientIP = forwarded[forwarded.length - trustedProxies]?.trim()
    if (clientIP) return clientIP
  }

  return getRequestIP(event) || 'unknown'
}

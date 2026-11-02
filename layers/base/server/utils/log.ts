import { useRuntimeConfig } from 'nuxt/server'
import { authLogs } from '#server/database/schema'
import { lt } from 'drizzle-orm/sql/expressions/conditions'
import type { RequestEvent } from 'nuxt/server'

export type LogOptions = {
  data?: unknown
  origin?: string // defaults to the event's path and method
  type?: string
  event?: RequestEvent // adds the user, IP address and user agent
}

export async function log(summary: string, { data, origin, type, event }: LogOptions = {}) {
  const session = event ? await getUserSession(event) : null

  await db.insert(authLogs).values({
    userId: session?.user?.id,
    type,
    origin: origin || (event ? `${event.url.pathname} ${event.req.method}` : undefined),
    summary,
    data,
    ipAddress: event ? getClientIP(event) : null,
    userAgent: event?.req.headers.get('user-agent'),
  })
}

export async function cleanLogs() {
  const config = useRuntimeConfig()
  const retentionMS = daysToMilliseconds(config.logs.retentionDays)
  const cutoffDate = new Date(Date.now() - retentionMS)

  await db.delete(authLogs).where(lt(authLogs.time, cutoffDate))
}

import { authLogs } from '#server/database/schema'
import { lt } from 'drizzle-orm/sql/expressions/conditions'
import type { H3Event } from 'h3'

export type LogOptions = {
  data?: unknown
  origin?: string // defaults to the event's path and method
  type?: string
  event?: H3Event // adds the user, IP address and user agent
}

export async function log(summary: string, { data, origin, type, event }: LogOptions = {}) {
  const session = event ? await getUserSession(event) : null
  const userAgent = event?.node?.req?.headers['user-agent']

  await db.insert(authLogs).values({
    userId: session?.user?.id,
    type,
    origin: origin || event?.path + ' ' + event?.node?.req?.method,
    summary,
    data,
    ipAddress: event ? getClientIP(event) : null,
    userAgent,
  })
}

export async function cleanLogs() {
  const config = useRuntimeConfig()
  const retentionMS = daysToMilliseconds(config.logs.retentionDays)
  const cutoffDate = new Date(Date.now() - retentionMS)

  await db.delete(authLogs).where(lt(authLogs.time, cutoffDate))
}

import { createError, deleteCookie, getCookie, setCookie, useRuntimeConfig } from 'nuxt/server'
import { authUsers, authRefreshTokens } from '#server/database/schema'
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'crypto'
import type { RequestEvent } from 'nuxt/server'

type AuthUser = typeof authUsers.$inferSelect
type SessionUser = Pick<AuthUser, 'id'> & Partial<Pick<AuthUser, 'email' | 'role'>>

export async function mfaSetupFlag(user: SessionUser) {
  const config = useRuntimeConfig()
  if (!config.forceMfa || !user.email) return

  const row = await db.query.authUsers.findFirst({
    where: { id: user.id },
    with: { credentials: true },
  })
  return { requiresMfaSetup: !row?.totp && !row?.credentials.length }
}

export function requireSecondFactor(user: Pick<AuthUser, 'totp'> & { credentials?: unknown[] }) {
  if (user.totp) {
    throw createError({
      status: 401,
      message: 'TOTP required',
    })
  }
  if (useRuntimeConfig().forceMfa && user.credentials?.length) {
    throw createError({
      status: 401,
      message: 'Passkey required',
    })
  }
}

export function passkeyUserVerification(): 'required' | 'preferred' {
  return useRuntimeConfig().forceMfa ? 'required' : 'preferred'
}

export function requireUserVerification(userVerified: boolean) {
  if (useRuntimeConfig().forceMfa && !userVerified) {
    throw createError({
      status: 400,
      message: 'Set a PIN on your security key to use it.',
    })
  }
}

// Without an email, the user is anonymous
export async function createAuthUser(event: RequestEvent, { email }: { email?: string } = {}) {
  const insertedUsers = await db
    .insert(authUsers)
    .values({
      email: email?.trim().toLowerCase(),
      // typed for h3 v1's event, Nuxt's Nitro v2 compatibility runs it on this one
      locale: useLocaleServerMiddleware(event as Parameters<typeof useLocaleServerMiddleware>[0])
        .current,
    })
    .returning()
  if (!insertedUsers[0]) {
    throw createError({
      status: 500,
      message: 'User creation failed',
    })
  }
  return insertedUsers[0]
}

export async function setAuthUserEmail(id: string, email: string) {
  const updatedUsers = await db
    .update(authUsers)
    .set({
      email: email.trim().toLowerCase(),
    })
    .where(eq(authUsers.id, id))
    .returning()
  if (!updatedUsers[0]) {
    throw createError({
      status: 500,
      message: 'User update failed',
    })
  }
  return updatedUsers[0]
}

type UserQueryOptions = { withCredentials?: boolean }

export async function requireAuthUser(
  event: RequestEvent,
  { withCredentials = false }: UserQueryOptions = {},
) {
  const id = (await getUserSession(event)).user?.id
  if (!id) {
    throw createError({
      status: 401,
      message: 'Not authenticated',
    })
  }

  const user = await db.query.authUsers.findFirst({
    where: { id },
    with: { credentials: withCredentials },
  })
  if (!user) {
    throw createError({
      status: 404,
      message: 'User not found',
    })
  }
  return user
}

export function findAuthUserByEmail(
  email: string,
  { withCredentials = false }: UserQueryOptions = {},
) {
  return db.query.authUsers.findFirst({
    where: { email: email.trim().toLowerCase() },
    with: { credentials: withCredentials },
  })
}

// refresh: false keeps the refresh token and authenticatedAt, to update the session data only
export async function setSession(event: RequestEvent, user: SessionUser, { refresh = true } = {}) {
  if (refresh) {
    if (useRuntimeConfig().session.unique) {
      await revokeAllUserTokens(user.id)
    } else {
      const existingToken = getCookie(event, 'refresh_token')
      if (existingToken) {
        await revokeRefreshToken(existingToken)
      }
    }
    await createRefreshToken(user.id, event)
  }

  const sessionMaxAge = useRuntimeConfig().session.maxAge
  const authenticatedAt = refresh
    ? Date.now()
    : ((await getUserSession(event)).authenticatedAt ?? 0)

  // replace, not set: setUserSession merges with defu, so an absent
  // requiresMfaSetup would never clear a previously flagged session
  return replaceUserSession(event, {
    user: {
      id: user.id,
      email: user.email?.trim().toLowerCase() ?? undefined,
      role: user.role || 'user',
      isAnonymous: !user.email,
      ...(await mfaSetupFlag(user)),
    },
    authenticatedAt,
    expiresAt: sessionMaxAge ? Date.now() + sessionMaxAge * 1000 : undefined,
  })
}

export async function requireRecentAuth(event: RequestEvent) {
  const session = await requireUserSession(event)

  if (session.user.isAnonymous) return session

  const maxAge = useRuntimeConfig().public.recentAuth.maxAge * 1000
  if (!session.authenticatedAt || Date.now() - session.authenticatedAt > maxAge) {
    throw createError({
      status: 403,
      statusText: 'reauth_required',
      message: 'Please verify your identity again to continue.',
    })
  }

  return session
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('base64url')
}

export async function updateLastActive(userId: string) {
  await db
    .update(authUsers)
    .set({ lastActiveOn: sql`current_date` })
    .where(and(eq(authUsers.id, userId), lt(authUsers.lastActiveOn, sql`current_date`)))
}

export async function cleanInactiveUsers() {
  const { retentionDays, warningDays } = useRuntimeConfig().inactiveUsers
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error(`Inactive users: invalid retentionDays ${JSON.stringify(retentionDays)}`)
  }
  const inactive = lt(authUsers.lastActiveOn, sql`current_date - ${retentionDays}::int`)

  const users = await db.select({ id: authUsers.id }).from(authUsers).where(inactive)
  const ids: string[] = []
  for (const { id } of users) {
    await deleteUserFiles(id).then(
      () => ids.push(id),
      () => {},
    )
  }

  if (ids.length) {
    const deleted = await db
      .delete(authUsers)
      .where(and(inArray(authUsers.id, ids), inactive))
      .returning({ id: authUsers.id })
    await log(`Deleted ${deleted.length} users inactive for ${retentionDays} days`, {
      origin: 'clean task',
    })
  }

  const failedWarnings = warningDays > 0 ? await warnInactiveUsers(retentionDays, warningDays) : 0

  const errors = []
  if (users.length > ids.length) {
    errors.push(`files of ${users.length - ids.length} users could not be deleted`)
  }
  if (failedWarnings) errors.push(`${failedWarnings} warnings failed to send`)
  if (errors.length) throw new Error(`Inactive users: ${errors.join(', ')}`)
}

async function warnInactiveUsers(retentionDays: number, warningDays: number) {
  const warnAfterDays = Math.max(retentionDays - warningDays, 0)

  const users = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      locale: authUsers.locale,
      lastActiveOn: authUsers.lastActiveOn,
    })
    .from(authUsers)
    .where(
      and(
        lt(authUsers.lastActiveOn, sql`current_date - ${warnAfterDays}::int`),
        isNotNull(authUsers.email),
        or(
          isNull(authUsers.deletionWarnedOn),
          lte(authUsers.deletionWarnedOn, authUsers.lastActiveOn),
        ),
      ),
    )

  let failed = 0
  for (const user of users) {
    // The first nightly run where lastActiveOn < current_date - retentionDays
    const deletionOn = new Date(user.lastActiveOn.getTime() + daysToMilliseconds(retentionDays + 1))
    const locale = user.locale ?? 'en'
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      deletionOn,
    )
    try {
      await sendEmailTemplate('inactiveDeletion', { to: user.email!, locale, params: { date } })
      await db
        .update(authUsers)
        .set({ deletionWarnedOn: sql`current_date` })
        .where(eq(authUsers.id, user.id))
    } catch {
      failed++
    }
  }

  if (users.length > failed) {
    await log(`Warned ${users.length - failed} inactive users of their deletion`, {
      origin: 'clean task',
    })
  }
  return failed
}

export async function createRefreshToken(userId: string, event: RequestEvent) {
  const token = generateRefreshToken()
  await updateLastActive(userId)

  await db.insert(authRefreshTokens).values({
    userId,
    token: hashRefreshToken(token),
  })

  const config = useRuntimeConfig()
  setCookie(event, 'refresh_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: config.refreshToken.maxAge,
    path: '/',
  })
  return token
}

export async function verifyRefreshToken(event: RequestEvent) {
  const existingToken = getCookie(event, 'refresh_token')
  if (!existingToken) {
    throw createError({
      status: 401,
      message: 'No token provided',
    })
  }

  const refreshToken = await db.query.authRefreshTokens.findFirst({
    where: { token: hashRefreshToken(existingToken) },
  })
  if (!refreshToken) {
    deleteCookie(event, 'refresh_token')
    throw createError({
      status: 401,
      message: 'No token found',
    })
  }

  const user = await db.query.authUsers.findFirst({
    where: { id: refreshToken.userId },
  })
  if (!user) {
    deleteCookie(event, 'refresh_token')
    throw createError({
      status: 401,
      message: 'No user found',
    })
  }

  if (refreshToken.createdAt <= refreshTokenCutoff()) {
    await cleanRefreshTokens()
    deleteCookie(event, 'refresh_token')
    throw createError({
      status: 401,
      message: 'Token expired',
    })
  }

  return { refreshToken, user }
}

// Takes the token from the cookie, never the stored value
export async function revokeRefreshToken(token: string) {
  await db.delete(authRefreshTokens).where(eq(authRefreshTokens.token, hashRefreshToken(token)))
}

function refreshTokenCutoff() {
  return new Date(Date.now() - useRuntimeConfig().refreshToken.maxAge * 1000)
}

export async function cleanRefreshTokens() {
  await db.delete(authRefreshTokens).where(lte(authRefreshTokens.createdAt, refreshTokenCutoff()))
}

export async function revokeAllUserTokens(userId: string) {
  await db.delete(authRefreshTokens).where(eq(authRefreshTokens.userId, userId))
}

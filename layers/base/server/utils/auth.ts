import { auth, refreshTokens } from '#server/database/schema'
import { and, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'crypto'
import type { H3Event } from 'h3'

type AuthUser = typeof auth.$inferSelect
type SessionUser = Pick<AuthUser, 'id'> & Partial<Pick<AuthUser, 'email' | 'role'>>

export async function mfaSetupFlag(user: SessionUser) {
  const config = useRuntimeConfig()
  if (!config.forceMfa || !user.email) return

  const row = await db.query.auth.findFirst({
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

export async function createAuth(user: Pick<AuthUser, 'email'>, event: H3Event) {
  const insertedUsers = await db
    .insert(auth)
    .values({
      email: user.email?.trim().toLowerCase(),
      locale: useLocaleServerMiddleware(event).current,
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

export async function setAuth(user: Pick<AuthUser, 'id' | 'email'>) {
  const insertedUsers = await db
    .update(auth)
    .set({
      email: user.email?.trim().toLowerCase(),
    })
    .where(eq(auth.id, user.id))
    .returning()
  if (!insertedUsers[0]) {
    throw createError({
      status: 500,
      message: 'User update failed',
    })
  }
  return insertedUsers[0]
}

export async function getAuth(event: H3Event, email?: string, credentials = false) {
  const id = email ? undefined : (await getUserSession(event)).user?.id
  // an undefined filter is dropped by drizzle, which would match an arbitrary user
  if (!email && !id) {
    throw createError({
      status: 401,
      message: 'Not authenticated',
    })
  }

  const where = email ? { email: email.trim().toLowerCase() } : { id }
  const user = await db.query.auth.findFirst({
    where,
    with: {
      credentials,
    },
  })
  if (!user) {
    throw createError({
      status: 404,
      message: 'User not found',
    })
  }
  return user
}

export async function setSession(event: H3Event, user: SessionUser, refresh = true) {
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

export async function requireRecentAuth(event: H3Event) {
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
    .update(auth)
    .set({ lastActiveOn: sql`current_date` })
    .where(and(eq(auth.id, userId), lt(auth.lastActiveOn, sql`current_date`)))
}

export async function cleanInactiveUsers() {
  const { retentionDays, warningDays } = useRuntimeConfig().inactiveUsers

  const deleted = await db
    .delete(auth)
    .where(lt(auth.lastActiveOn, sql`current_date - ${retentionDays}::int`))
    .returning({ id: auth.id })

  if (deleted.length) {
    await log(
      `Deleted ${deleted.length} users inactive for ${retentionDays} days`,
      undefined,
      'clean task',
    )
  }

  if (warningDays > 0) await warnInactiveUsers(retentionDays, warningDays)
}

async function warnInactiveUsers(retentionDays: number, warningDays: number) {
  const warnAfterDays = Math.max(retentionDays - warningDays, 0)

  const users = await db
    .select({
      id: auth.id,
      email: auth.email,
      locale: auth.locale,
      lastActiveOn: auth.lastActiveOn,
    })
    .from(auth)
    .where(
      and(
        lt(auth.lastActiveOn, sql`current_date - ${warnAfterDays}::int`),
        isNotNull(auth.email),
        or(isNull(auth.deletionWarnedOn), lte(auth.deletionWarnedOn, auth.lastActiveOn)),
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
      await sendEmailTemplate('inactiveDeletion', locale, { date }, user.email!)
      await db
        .update(auth)
        .set({ deletionWarnedOn: sql`current_date` })
        .where(eq(auth.id, user.id))
    } catch {
      failed++
    }
  }

  if (users.length > failed) {
    await log(
      `Warned ${users.length - failed} inactive users of their deletion`,
      undefined,
      'clean task',
    )
  }
  if (failed) {
    throw new Error(`${failed} of ${users.length} inactive user warnings failed to send`)
  }
}

export async function createRefreshToken(userId: string, event: H3Event) {
  const token = generateRefreshToken()
  await updateLastActive(userId)

  await db.insert(refreshTokens).values({
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

export async function verifyRefreshToken(event: H3Event) {
  const existingToken = getCookie(event, 'refresh_token')
  if (!existingToken) {
    throw createError({
      status: 401,
      message: 'No token provided',
    })
  }

  const refreshToken = await db.query.refreshTokens.findFirst({
    where: { token: hashRefreshToken(existingToken) },
  })
  if (!refreshToken) {
    deleteCookie(event, 'refresh_token')
    throw createError({
      status: 401,
      message: 'No token found',
    })
  }

  const user = await db.query.auth.findFirst({
    where: { id: refreshToken.userId },
  })
  if (!user) {
    deleteCookie(event, 'refresh_token')
    throw createError({
      status: 401,
      message: 'No user found',
    })
  }

  const config = useRuntimeConfig()
  const createdAt = refreshToken.createdAt.getTime()
  const creationExpiredAt = Date.now() - config.refreshToken.maxAge * 1000

  if (createdAt < creationExpiredAt) {
    await revokeExpiredRefreshToken(new Date(creationExpiredAt))
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
  await db.delete(refreshTokens).where(eq(refreshTokens.token, hashRefreshToken(token)))
}

export async function revokeExpiredRefreshToken(creationExpiredAt: Date) {
  await db.delete(refreshTokens).where(lte(refreshTokens.createdAt, creationExpiredAt))
}

export async function revokeAllUserTokens(userId: string) {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId))
}

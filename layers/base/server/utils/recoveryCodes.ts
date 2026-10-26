import { and, eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { recoveryCodes } from '#server/database/schema'

const RECOVERY_CODE_COUNT = 10

function generateRecoveryCode() {
  const code = randomBytes(5).toString('hex')
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

function normalizeRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^0-9a-f]/g, '')
}

export async function generateRecoveryCodes(userId: string) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
  const hashes = await Promise.all(codes.map((code) => hashPassword(normalizeRecoveryCode(code))))

  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await tx.insert(recoveryCodes).values(hashes.map((code) => ({ userId, code })))
  })

  return codes
}

export async function consumeRecoveryCode(userId: string, code: string) {
  const normalized = normalizeRecoveryCode(code)
  const rows = await db
    .select({ code: recoveryCodes.code })
    .from(recoveryCodes)
    .where(eq(recoveryCodes.userId, userId))

  let match: string | undefined
  for (const row of rows) {
    if (await verifyPassword(row.code, normalized)) {
      match = row.code
      break
    }
  }
  if (!match) return null

  const deleted = await db
    .delete(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.code, match)))
    .returning()
  // a concurrent request used it first
  if (!deleted.length) return null

  return rows.length - 1
}

export function countRecoveryCodes(userId: string) {
  return db.$count(recoveryCodes, eq(recoveryCodes.userId, userId))
}

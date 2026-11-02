import { useRuntimeConfig } from 'nuxt/server'
import { defineTask } from 'nitro/task'

export default defineTask({
  meta: {
    name: 'clean',
    description:
      'Clean old backups, logs, unfinished uploads, expired refresh tokens and inactive users',
  },
  async run() {
    const config = useRuntimeConfig()

    const steps: [string, () => Promise<unknown>][] = [['backups', cleanOldBackups]]
    if (config.s3.privateBucket) steps.push(['S3 backups', cleanOldS3Backups])
    steps.push(
      ['logs', cleanLogs],
      ['uploads', () => cleanTempUploads()],
      ['refresh tokens', cleanRefreshTokens],
    )
    if (config.inactiveUsers.retentionDays) steps.push(['inactive users', cleanInactiveUsers])

    const results = await Promise.allSettled(steps.map(([, step]) => step()))

    let success = true
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') continue
      success = false
      const error = result.reason
      await log(`Cleaning ${steps[i]![0]} failed: ${error?.message}`, {
        data: { stack: error?.stack, cause: error?.cause },
        origin: 'clean task',
        type: 'error',
      })
    }

    return {
      result: {
        success,
      },
    }
  },
})

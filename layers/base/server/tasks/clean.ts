export default defineTask({
  meta: {
    name: 'clean',
    description: 'Clean old backups, logs and unfinished uploads',
  },
  async run() {
    const config = useRuntimeConfig()

    const steps: [string, () => Promise<unknown>][] = [['backups', cleanOldBackups]]
    if (config.s3.privateBucket) steps.push(['S3 backups', cleanOldS3Backups])
    steps.push(['logs', cleanLogs], ['uploads', () => cleanTempUploads()])

    const results = await Promise.allSettled(steps.map(([, step]) => step()))

    let success = true
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') continue
      success = false
      const error = result.reason
      await log(
        `Cleaning ${steps[i]![0]} failed: ${error?.message}`,
        { stack: error?.stack, cause: error?.cause },
        'clean task',
        'error',
      )
    }

    return {
      result: {
        success,
      },
    }
  },
})

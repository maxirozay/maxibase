export default defineTask({
  meta: {
    name: 'clean',
    description: 'Clean old backups, logs and unfinished uploads',
  },
  async run() {
    const config = useRuntimeConfig()

    try {
      await cleanOldBackups()
      if (config.s3.privateBucket) {
        const backups = await listFromS3('backups', true)
        const retentionMs = daysToMilliseconds(config.backup.retentionDays)
        const cutoffDate = new Date(Date.now() - retentionMs)
        await Promise.all(
          backups.map((b) => {
            if (b.updatedAt && b.updatedAt < cutoffDate) {
              return deleteFromS3(`backups/${b.name}`, true)
            }
          }),
        )
      }
      await cleanLogs()
      await cleanTempUploads()

      return {
        result: {
          success: true,
        },
      }
    } catch (error: any) {
      await log(error.message, { stack: error.stack, cause: error.cause }, 'clean task', 'error')
      return {
        result: {
          success: false,
        },
      }
    }
  },
})

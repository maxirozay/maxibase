import { useRuntimeConfig } from 'nuxt/server'
import { defineTask } from 'nitro/task'
import { createReadStream } from 'fs'

export default defineTask({
  meta: {
    name: 'backup',
    description: 'Backup DB',
  },
  async run() {
    const timestamp = new Date().toISOString()
    try {
      const config = useRuntimeConfig()
      const agePublicKey = config.backup.agePublicKey
      const backupName = `backups/backup-${timestamp}.dump${agePublicKey ? '.age' : ''}`

      await createDatabaseBackup(backupName, {
        dbUrl: config.db,
        dumpArgs: config.backup.dumpArgs,
        agePublicKey,
      })
      if (config.s3.privateBucket) {
        await uploadStreamToS3(backupName, createReadStream(backupName), {
          cacheControl: 'private',
          isPrivate: true,
        })
      }
      await log('Backup created', { data: { backupName }, origin: 'backup task', type: 'info' })

      return {
        result: {
          success: true,
        },
      }
    } catch (error: any) {
      await log(error.message, {
        data: { stack: error.stack, cause: error.cause },
        origin: 'backup task',
        type: 'error',
      })

      return {
        result: {
          success: false,
        },
      }
    }
  },
})

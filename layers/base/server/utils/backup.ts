import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

// pg_dump takes the connection string in argv, where `ps` shows it to every process on
// the host, so move the password into the child's environment instead.
function splitCredentials(dbUrl: string) {
  try {
    const url = new URL(dbUrl)
    if (!url.password) return { conn: dbUrl, env: {} }
    const password = decodeURIComponent(url.password)
    url.password = ''
    return { conn: url.toString(), env: { PGPASSWORD: password } }
  } catch {
    return { conn: dbUrl, env: {} } // a libpq keyword/value string, leave it alone
  }
}

function waitForExit(child: ChildProcess, name: string) {
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000)
  })

  return new Promise<void>((resolve, reject) => {
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'ENOENT' ? new Error(`${name} is not installed`) : e),
    )
    child.on('close', (code, signal) => {
      if (code === 0) return resolve()
      const how = signal ? `signal ${signal}` : `exit code ${code}`
      reject(new Error(`${name} failed (${how})${stderr ? `: ${stderr.trim()}` : ''}`))
    })
  })
}

export async function createDatabaseBackup(
  backupName: string,
  dbUrl: string,
  dumpArgs: string,
  agePublicKey?: string,
) {
  const { conn, env } = splitCredentials(dbUrl)
  const args = [...dumpArgs.split(' ').filter(Boolean), conn]
  const options = { env: { ...process.env, ...env } }

  if (!agePublicKey) {
    const dump = spawn('pg_dump', [...args, '-f', backupName], {
      ...options,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return waitForExit(dump, 'pg_dump')
  }

  // age needs only the public key, so the server can write backups it cannot read back.
  // Piping keeps the plaintext dump off the disk entirely.
  const dump = spawn('pg_dump', args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  const encrypt = spawn('age', ['-r', agePublicKey, '-o', backupName], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  dump.stdout!.on('error', () => {}) // the EPIPE that follows the kills below
  encrypt.stdin!.on('error', () => {})
  dump.stdout!.pipe(encrypt.stdin!)

  // Either one dying leaves the other blocked on a pipe nobody touches again.
  dump.on('close', (code) => code !== 0 && encrypt.kill())
  encrypt.on('close', (code) => code !== 0 && dump.kill())

  // Kept in the order they happened: the first is the cause, any second is just the
  // peer reporting the pipe we broke.
  const errors: Error[] = []
  const collect = (child: ChildProcess, name: string) =>
    waitForExit(child, name).catch((e) => void errors.push(e))
  await Promise.all([collect(dump, 'pg_dump'), collect(encrypt, 'age')])

  if (errors.length) {
    await fs.rm(backupName, { force: true }) // a truncated .age is not a backup
    throw errors[0]
  }
}

export async function cleanOldBackups() {
  const backupDir = path.resolve(process.cwd(), 'backups')
  const files = await fs.readdir(backupDir)
  const now = Date.now()
  const config = useRuntimeConfig()
  const retentionMs = daysToMilliseconds(config.backup.retentionDays)

  await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(backupDir, file)
      const stats = await fs.stat(filePath)
      if (now - stats.mtimeMs > retentionMs) {
        await fs.unlink(filePath) // Delete old backup
      }
    }),
  )
}

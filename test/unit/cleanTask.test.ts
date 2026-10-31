import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logSpy, resetTestState, setConfig } from '../setup'

vi.hoisted(() => Object.assign(globalThis, { defineTask: (task: unknown) => task }))
const { default: task } = (await import('../../layers/base/server/tasks/clean')) as any

const steps = {
  cleanOldBackups: vi.fn(),
  cleanOldS3Backups: vi.fn(),
  cleanLogs: vi.fn(),
  cleanTempUploads: vi.fn(),
  cleanInactiveUsers: vi.fn(),
}

beforeEach(() => {
  resetTestState()
  for (const [name, step] of Object.entries(steps)) {
    step.mockReset()
    step.mockResolvedValue(undefined)
    vi.stubGlobal(name, step)
  }
})

const withS3 = () => setConfig({ s3: { privateBucket: 'private' } })

describe('clean task', () => {
  it('cleans the server backups, logs and uploads', async () => {
    expect(await task.run()).toEqual({ result: { success: true } })
    expect(steps.cleanOldBackups).toHaveBeenCalledOnce()
    expect(steps.cleanOldS3Backups).not.toHaveBeenCalled()
    expect(steps.cleanLogs).toHaveBeenCalledOnce()
    expect(steps.cleanTempUploads).toHaveBeenCalledOnce()
    expect(steps.cleanInactiveUsers).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('deletes inactive users only when a retention is set', async () => {
    setConfig({ inactiveUsers: { retentionDays: 730, warningDays: 30 } })
    await task.run()
    expect(steps.cleanInactiveUsers).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, ''])(
    'skips inactive users with retentionDays %j',
    async (retentionDays) => {
      setConfig({ inactiveUsers: { retentionDays, warningDays: 30 } })
      await task.run()
      expect(steps.cleanInactiveUsers).not.toHaveBeenCalled()
    },
  )

  // Not skipped silently, so the misconfiguration shows up in the logs
  it('runs inactive users with an invalid retentionDays', async () => {
    setConfig({ inactiveUsers: { retentionDays: true, warningDays: 30 } })
    await task.run()
    expect(steps.cleanInactiveUsers).toHaveBeenCalledOnce()
  })

  // The backup task keeps its server copy after uploading, so both places are cleaned.
  it('also cleans the S3 backups with a private bucket', async () => {
    withS3()
    await task.run()
    expect(steps.cleanOldBackups).toHaveBeenCalledOnce()
    expect(steps.cleanOldS3Backups).toHaveBeenCalledOnce()
  })

  // Logs hold IP addresses: a missing backups folder must not keep them past
  // their retention.
  it('still cleans logs and uploads when the backups fail', async () => {
    steps.cleanOldBackups.mockRejectedValue(new Error('ENOENT: no such file or directory'))
    expect(await task.run()).toEqual({ result: { success: false } })
    expect(steps.cleanLogs).toHaveBeenCalledOnce()
    expect(steps.cleanTempUploads).toHaveBeenCalledOnce()
  })

  it('logs each failed step under its own name', async () => {
    withS3()
    steps.cleanOldBackups.mockRejectedValue(new Error('no folder'))
    steps.cleanOldS3Backups.mockRejectedValue(new Error('S3 down'))
    await task.run()
    expect(logSpy).toHaveBeenCalledTimes(2)
    expect(logSpy).toHaveBeenCalledWith(
      'Cleaning backups failed: no folder',
      expect.anything(),
      'clean task',
      'error',
    )
    expect(logSpy).toHaveBeenCalledWith(
      'Cleaning S3 backups failed: S3 down',
      expect.anything(),
      'clean task',
      'error',
    )
  })
})

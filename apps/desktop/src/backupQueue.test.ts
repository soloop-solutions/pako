import { describe, expect, it } from 'vitest'
import { BackupQueue } from './backupQueue'
import { startScheduler, type SchedulerDeps } from './scheduler'
import { stopAfterCloseBackup } from './shutdown'

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function fakeDump(name: string, log: string[]) {
  return (signal: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      log.push(`${name}:dumping`)
      signal.addEventListener('abort', () => {
        log.push(`${name}:killed`, `${name}:temp-removed`)
        reject(new Error('Backup aborted'))
      })
    })
}

function closeHarness(lastBackupAt: Date | null) {
  const start = new Date(2026, 10, 18, 17, 0, 0).getTime()
  let clock = start
  const timers: { fn: () => void; at: number; id: number }[] = []
  let nextId = 1
  const log: string[] = []
  const queue = new BackupQueue()
  const deps: SchedulerDeps = {
    now: () => new Date(clock),
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.push({ fn, at: clock + ms, id })
      return id
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    lastBackupAt: async () => lastBackupAt,
    backup: (signal) => queue.backup(fakeDump('close', log), signal),
    log: () => {},
    closeBoundMs: 10000,
    abortAll: () => queue.abortBackups(),
    idle: () => queue.idle(),
  }
  const scheduler = startScheduler(deps)
  scheduler.stop()
  const fireBound = () => {
    const t = timers.shift()!
    clock = t.at
    t.fn()
  }
  return { queue, scheduler, log, timers, fireBound, elapsed: () => clock - start }
}

describe('close backup bound', () => {
  it('Close_ManualBackupRunning_NoBackupToday_AbortedAtBound_AndChildrenStopped', async () => {
    const h = closeHarness(null)
    const manual = h.queue.backup(fakeDump('manual', h.log)).catch((e: Error) => e.message)
    await flush()

    const closing = stopAfterCloseBackup({
      closeBackup: () => h.scheduler.onClose(),
      stopAll: async () => void h.log.push('stopAll'),
      log: (m) => void h.log.push(`log:${m}`),
    })
    await flush()
    expect(h.log).toEqual(['manual:dumping'])
    expect(h.timers.map((t) => t.at)).toHaveLength(1)

    h.fireBound()
    await closing

    expect(h.elapsed()).toBe(10000)
    expect(await manual).toBe('Backup aborted')
    expect(h.log).toEqual([
      'manual:dumping',
      'manual:killed',
      'manual:temp-removed',
      'log:close backup failed: Backup aborted',
      'stopAll',
    ])
  })

  it('Close_ManualBackupRunning_BackupAlreadyToday_NoWaitBeyondBound', async () => {
    const h = closeHarness(new Date(2026, 10, 18, 9, 0, 0))
    const manual = h.queue.backup(fakeDump('manual', h.log)).catch((e: Error) => e.message)
    await flush()

    let done = false
    const closing = stopAfterCloseBackup({
      closeBackup: () => h.scheduler.onClose(),
      stopAll: async () => void h.log.push('stopAll'),
      log: (m) => void h.log.push(`log:${m}`),
    }).then(() => (done = true))
    await flush()
    expect(done).toBe(false)
    expect(h.log).not.toContain('stopAll')

    h.fireBound()
    await closing

    expect(h.elapsed()).toBe(10000)
    expect(await manual).toBe('Backup aborted')
    expect(h.log).toEqual(['manual:dumping', 'manual:killed', 'manual:temp-removed', 'stopAll'])
  })

  it('Close_NothingRunning_BackupAlreadyToday_ReturnsAtOnce', async () => {
    const h = closeHarness(new Date(2026, 10, 18, 9, 0, 0))
    expect(await h.scheduler.onClose()).toBe(false)
    expect(h.timers).toHaveLength(0)
  })

  it('Queue_RestoreIsNotAborted_ButLaterBackupsAre', async () => {
    const queue = new BackupQueue()
    let finish = () => {}
    const restore = queue.exclusive(() => new Promise<string>((r) => (finish = () => r('restored'))))
    const later = queue.backup(async () => 'backed up').catch((e: Error) => e.message)
    queue.abortBackups()
    await flush()
    finish()
    expect(await restore).toBe('restored')
    expect(await later).toBe('Backup aborted')
    await queue.idle()
  })
})

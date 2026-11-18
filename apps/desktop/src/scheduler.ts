export interface SchedulerDeps {
  now(): Date
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  lastBackupAt(): Promise<Date | null>
  backup(signal?: AbortSignal): Promise<void>
  log(message: string): void
  hour?: number
  closeBoundMs?: number
}

export interface Scheduler {
  stop(): void
  onClose(): Promise<boolean>
}

export const CLOSE_BACKUP_BOUND_MS = 10000

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function msUntilNext(now: Date, hour: number): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const hour = deps.hour ?? 2
  const closeBoundMs = deps.closeBoundMs ?? CLOSE_BACKUP_BOUND_MS
  const controller = new AbortController()
  let handle: unknown
  let stopped = false
  let running: Promise<boolean> | undefined

  const runIfDue = (): Promise<boolean> => {
    if (running) return running
    running = (async () => {
      const last = await deps.lastBackupAt()
      if (last && sameLocalDay(last, deps.now())) return false
      if (controller.signal.aborted) throw new Error('Backup aborted')
      await deps.backup(controller.signal)
      return true
    })().finally(() => {
      running = undefined
    })
    return running
  }

  const schedule = () => {
    if (stopped) return
    handle = deps.setTimer(() => {
      handle = undefined
      void runIfDue()
        .catch((err) => deps.log(`scheduled backup failed: ${err instanceof Error ? err.message : String(err)}`))
        .finally(schedule)
    }, msUntilNext(deps.now(), hour))
  }

  schedule()

  return {
    stop() {
      stopped = true
      if (handle !== undefined) deps.clearTimer(handle)
      handle = undefined
    },
    async onClose() {
      const bound = deps.setTimer(() => controller.abort(), closeBoundMs)
      try {
        if (running) {
          await running.catch((err) => {
            if (controller.signal.aborted) throw err
          })
        }
        return await runIfDue()
      } finally {
        deps.clearTimer(bound)
      }
    },
  }
}

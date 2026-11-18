export interface SchedulerDeps {
  now(): Date
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  lastBackupAt(): Promise<Date | null>
  backup(): Promise<void>
  log(message: string): void
  hour?: number
}

export interface Scheduler {
  stop(): void
  onClose(): Promise<boolean>
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function msUntilNext(now: Date, hour: number): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const hour = deps.hour ?? 2
  let handle: unknown
  let stopped = false
  let running: Promise<boolean> | undefined

  const runIfDue = (): Promise<boolean> => {
    if (running) return running
    running = (async () => {
      const last = await deps.lastBackupAt()
      if (last && sameLocalDay(last, deps.now())) return false
      await deps.backup()
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
      if (running) await running.catch(() => false)
      return runIfDue()
    },
  }
}

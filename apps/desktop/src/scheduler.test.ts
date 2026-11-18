import { describe, expect, it } from 'vitest'
import { msUntilNext, startScheduler, type SchedulerDeps } from './scheduler'

function harness(start: Date, last: Date | null = null) {
  let clock = start.getTime()
  let lastAt = last
  const timers: { fn: () => void; at: number; id: number }[] = []
  let nextId = 1
  const runs: string[] = []
  const deps: SchedulerDeps = {
    now: () => new Date(clock),
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++
      timers.push({ fn, at: clock + ms, id })
      return id
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    lastBackupAt: async () => lastAt,
    backup: async () => {
      runs.push(new Date(clock).toISOString())
      lastAt = new Date(clock)
    },
    log: () => {},
  }
  const fire = async () => {
    const t = timers.shift()!
    clock = t.at
    t.fn()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }
  const advance = (ms: number) => {
    clock += ms
  }
  const fireAt = async (offsetMs: number, from: Date) => {
    const i = timers.findIndex((t) => t.at === from.getTime() + offsetMs)
    if (i < 0) throw new Error(`no timer at +${offsetMs}ms`)
    const [t] = timers.splice(i, 1)
    clock = t!.at
    t!.fn()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  }
  return { deps, timers, runs, fire, fireAt, advance }
}

const hour = 60 * 60 * 1000

describe('scheduler', () => {
  it('msUntilNext targets the next local occurrence of the hour', () => {
    expect(msUntilNext(new Date(2026, 10, 18, 1, 0, 0), 2)).toBe(hour)
    expect(msUntilNext(new Date(2026, 10, 18, 2, 0, 0), 2)).toBe(24 * hour)
    expect(msUntilNext(new Date(2026, 10, 18, 14, 0, 0), 2)).toBe(12 * hour)
  })

  it('Scheduler_RunsNightly_WhileOpen_AndReschedules', async () => {
    const h = harness(new Date(2026, 10, 18, 14, 0, 0))
    const s = startScheduler(h.deps)
    expect(h.timers).toHaveLength(1)
    await h.fire()
    expect(h.runs).toHaveLength(1)
    expect(new Date(h.runs[0]!).getHours()).toBe(2)
    expect(h.timers).toHaveLength(1)
    await h.fire()
    expect(h.runs).toHaveLength(2)
    s.stop()
    expect(h.timers).toHaveLength(0)
  })

  it('Scheduler_SkipsNightly_WhenABackupExistsToday', async () => {
    const h = harness(new Date(2026, 10, 18, 1, 0, 0), new Date(2026, 10, 18, 0, 30, 0))
    startScheduler(h.deps)
    await h.fire()
    expect(h.runs).toEqual([])
    expect(h.timers).toHaveLength(1)
  })

  it('Scheduler_OnClose_BacksUpAtMostOncePerDay', async () => {
    const h = harness(new Date(2026, 10, 18, 9, 0, 0), new Date(2026, 10, 17, 18, 0, 0))
    const s = startScheduler(h.deps)
    expect(await s.onClose()).toBe(true)
    h.advance(hour)
    expect(await s.onClose()).toBe(false)
    expect(h.runs).toHaveLength(1)
    h.advance(24 * hour)
    expect(await s.onClose()).toBe(true)
    expect(h.runs).toHaveLength(2)
  })

  it('Scheduler_OnClose_WaitsForARunningNightlyBackup', async () => {
    const h = harness(new Date(2026, 10, 18, 1, 59, 0))
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const original = h.deps.backup
    let calls = 0
    h.deps.backup = async () => {
      calls++
      await gate
      await original()
    }
    const s = startScheduler(h.deps)
    const t = h.timers.shift()!
    t.fn()
    const closing = s.onClose()
    release()
    expect(await closing).toBe(false)
    expect(calls).toBe(1)
  })

  it('Scheduler_BackupFailure_IsLogged_AndNextNightStillScheduled', async () => {
    const h = harness(new Date(2026, 10, 18, 14, 0, 0))
    const logged: string[] = []
    h.deps.backup = async () => {
      throw new Error('disk full')
    }
    h.deps.log = (m: string) => logged.push(m)
    startScheduler(h.deps)
    await h.fire()
    expect(logged.join()).toMatch(/disk full/)
    expect(h.timers).toHaveLength(1)
  })

  const hanging = (signals: AbortSignal[]) => (signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signals.push(signal!)
      signal!.addEventListener('abort', () => reject(new Error('backup aborted')))
    })

  it('Scheduler_OnClose_AbandonsTheBackupAtItsBound', async () => {
    const h = harness(new Date(2026, 10, 18, 9, 0, 0))
    const signals: AbortSignal[] = []
    h.deps.backup = hanging(signals)
    h.deps.closeBoundMs = 10000
    const s = startScheduler(h.deps)
    s.stop()

    const closing = s.onClose().then(() => null, (e: Error) => e)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.timers.map((t) => t.at - new Date(2026, 10, 18, 9, 0, 0).getTime())).toEqual([10000])
    expect(signals[0]!.aborted).toBe(false)

    await h.fire()

    expect((await closing)?.message).toBe('backup aborted')
    expect(signals[0]!.aborted).toBe(true)
  })

  it('Scheduler_OnClose_AbortsARunningNightlyBackupAtTheBound', async () => {
    const h = harness(new Date(2026, 10, 18, 1, 59, 0))
    const signals: AbortSignal[] = []
    h.deps.backup = hanging(signals)
    const s = startScheduler(h.deps)
    h.timers.shift()!.fn()
    s.stop()

    const closing = s.onClose().then(() => null, (e: Error) => e)
    await new Promise((r) => setTimeout(r, 0))
    await h.fire()

    expect((await closing)?.message).toBe('backup aborted')
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
  })

  it('Scheduler_OnClose_ClearsItsBoundTimer_WhenBackupFinishesInTime', async () => {
    const h = harness(new Date(2026, 10, 18, 9, 0, 0))
    const s = startScheduler(h.deps)
    s.stop()
    expect(await s.onClose()).toBe(true)
    expect(h.timers).toHaveLength(0)
  })

  describe('catch-up backup after startup', () => {
    const start = new Date(2026, 10, 18, 9, 0, 0)
    const yesterday = new Date(2026, 10, 17, 18, 0, 0)
    const minute = 60 * 1000

    it('CatchUp_RunsOnce_WhenNoBackupToday', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      startScheduler(h.deps)
      expect(h.timers).toHaveLength(2)
      expect(h.runs).toEqual([])

      await h.fireAt(minute, start)

      expect(h.runs).toEqual([new Date(start.getTime() + minute).toISOString()])
      expect(h.timers).toHaveLength(1)
    })

    it('CatchUp_RunsWhenThereIsNoBackupAtAll', async () => {
      const h = harness(start, null)
      h.deps.catchUpDelayMs = minute
      startScheduler(h.deps)
      await h.fireAt(minute, start)
      expect(h.runs).toHaveLength(1)
    })

    it('CatchUp_Skipped_WhenABackupExistsToday', async () => {
      const h = harness(start, new Date(2026, 10, 18, 0, 30, 0))
      h.deps.catchUpDelayMs = minute
      startScheduler(h.deps)
      await h.fireAt(minute, start)
      expect(h.runs).toEqual([])
      expect(h.timers).toHaveLength(1)
    })

    it('CatchUp_NotScheduled_WithoutADelay', () => {
      const h = harness(start, yesterday)
      startScheduler(h.deps)
      expect(h.timers).toHaveLength(1)
    })

    it('CatchUp_DoesNotRunTwiceInASession', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      let last: Date | null = yesterday
      h.deps.lastBackupAt = async () => last
      const s = startScheduler(h.deps)
      await h.fireAt(minute, start)
      expect(h.runs).toHaveLength(1)
      last = yesterday
      expect(h.timers).toHaveLength(1)
      expect(h.timers[0]!.at).toBe(new Date(2026, 10, 19, 2, 0, 0).getTime())
      s.stop()
    })

    it('CatchUp_NotRun_WhileARestoreIsRunning_RetriesAfterwards', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      let restoring = true
      h.deps.isRestoring = () => restoring
      startScheduler(h.deps)

      await h.fireAt(minute, start)
      expect(h.runs).toEqual([])
      expect(h.timers).toHaveLength(2)

      restoring = false
      await h.fireAt(2 * minute, start)
      expect(h.runs).toHaveLength(1)
      expect(h.timers).toHaveLength(1)
    })

    it('CatchUp_Stop_BeforeTheDelay_CancelsIt', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      const s = startScheduler(h.deps)
      s.stop()
      expect(h.timers).toHaveLength(0)
      expect(h.runs).toEqual([])
    })

    it('CatchUp_IsAbortedByTheSharedShutdownSignal', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      h.deps.closeBoundMs = 10000
      const signals: AbortSignal[] = []
      let abortedAll = 0
      h.deps.abortAll = () => abortedAll++
      h.deps.backup = hanging(signals)
      const s = startScheduler(h.deps)
      await h.fireAt(minute, start)
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(false)

      s.stop()
      const closing = s.onClose().then(() => null, (e: Error) => e)
      await new Promise((r) => setTimeout(r, 0))
      await h.fireAt(minute + 10000, start)

      expect((await closing)?.message).toBe('backup aborted')
      expect(signals[0]!.aborted).toBe(true)
      expect(abortedAll).toBe(1)
      expect(signals).toHaveLength(1)
    })

    it('CatchUp_Failure_IsLogged_AndReportedInTheStatus', async () => {
      const h = harness(start, yesterday)
      h.deps.catchUpDelayMs = minute
      const logged: string[] = []
      h.deps.log = (m: string) => logged.push(m)
      h.deps.backup = async () => {
        throw new Error('disk full')
      }
      const s = startScheduler(h.deps)
      expect(s.status().lastFailure).toBeNull()

      await h.fireAt(minute, start)

      expect(logged.join()).toMatch(/disk full/)
      expect(s.status().lastFailure).toEqual({ at: new Date(start.getTime() + minute).toISOString(), error: 'disk full' })
      expect(h.timers).toHaveLength(1)
    })

    it('CatchUp_Success_ClearsAnEarlierFailure', async () => {
      const h = harness(new Date(2026, 10, 18, 1, 59, 0), yesterday)
      h.deps.catchUpDelayMs = 2 * minute
      let fail = true
      const original = h.deps.backup
      h.deps.backup = async (signal) => {
        if (fail) throw new Error('disk full')
        await original(signal)
      }
      const s = startScheduler(h.deps)
      await h.fireAt(minute, new Date(2026, 10, 18, 1, 59, 0))
      expect(s.status().lastFailure?.error).toBe('disk full')
      fail = false
      await h.fireAt(2 * minute, new Date(2026, 10, 18, 1, 59, 0))
      expect(s.status().lastFailure).toBeNull()
    })
  })
})

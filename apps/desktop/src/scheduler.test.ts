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
  return { deps, timers, runs, fire, advance }
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
})

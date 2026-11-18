import { describe, expect, it } from 'vitest'
import { Supervisor, type ManagedChild } from './supervisor'

type FakeChild = ManagedChild & { crash(code: number): void; starts: number }

function fakeChild(name: string, log: string[]): FakeChild {
  let exitCb: ((code: number | null) => void) | undefined
  const child: FakeChild = {
    starts: 0,
    async start() {
      child.starts++
      log.push(`start:${name}`)
    },
    async stop() {
      log.push(`stop:${name}`)
    },
    onExit(cb) {
      exitCb = cb
    },
    crash(code) {
      exitCb?.(code)
    },
  }
  return child
}

function apiChild(log: string[]) {
  return Object.assign(fakeChild('api', log), {
    url: 'http://127.0.0.1:6000',
    async waitHealthy(_timeoutMs: number) {
      log.push('healthy:api')
    },
  })
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('supervisor', () => {
  it('Supervisor_StartsPostgresBeforeApi', async () => {
    const log: string[] = []
    const s = new Supervisor({ pg: fakeChild('pg', log), api: apiChild(log) })
    const r = await s.startAll()
    expect(log).toEqual(['start:pg', 'start:api', 'healthy:api'])
    expect(r.apiUrl).toBe('http://127.0.0.1:6000')
  })

  it('Supervisor_StopsPostgresEvenWhenApiStopThrows', async () => {
    const log: string[] = []
    const api = apiChild(log)
    api.stop = async () => {
      throw new Error('api stop failed')
    }
    const s = new Supervisor({ pg: fakeChild('pg', log), api })
    await s.startAll()
    log.length = 0
    await expect(s.stopAll()).rejects.toThrow('api stop failed')
    expect(log).toEqual(['stop:pg'])
  })

  it('Supervisor_StopsApiBeforePostgres', async () => {
    const log: string[] = []
    const s = new Supervisor({ pg: fakeChild('pg', log), api: apiChild(log) })
    await s.startAll()
    log.length = 0
    await s.stopAll()
    expect(log).toEqual(['stop:api', 'stop:pg'])
  })

  it('Supervisor_RestartsCrashedChildOnce_ThenReports', async () => {
    const log: string[] = []
    const api = apiChild(log)
    const s = new Supervisor({ pg: fakeChild('pg', log), api })
    const events: { name: string; code: number | null }[] = []
    s.on('child-exited', (e) => events.push(e))
    await s.startAll()

    api.crash(1)
    await tick()
    expect(api.starts).toBe(2)
    expect(events).toEqual([])

    api.crash(137)
    await tick()
    expect(api.starts).toBe(2)
    expect(events).toEqual([{ name: 'api', code: 137 }])
  })

  it('Supervisor_DoesNotReportExitDuringStop', async () => {
    const log: string[] = []
    const api = apiChild(log)
    const pg = fakeChild('pg', log)
    const s = new Supervisor({ pg, api })
    const events: unknown[] = []
    s.on('child-exited', (e) => events.push(e))
    await s.startAll()
    await s.stopAll()
    api.crash(0)
    pg.crash(0)
    await tick()
    expect(events).toEqual([])
    expect(api.starts).toBe(1)
  })

  it('Supervisor_StopApi_ForMaintenance_DoesNotRestartOrReport', async () => {
    const log: string[] = []
    const api = apiChild(log)
    const s = new Supervisor({ pg: fakeChild('pg', log), api })
    const events: unknown[] = []
    s.on('child-exited', (e) => events.push(e))
    await s.startAll()
    log.length = 0

    await s.stopApi()
    api.crash(0)
    await tick()
    expect(log).toEqual(['stop:api'])
    expect(events).toEqual([])

    await s.startApi()
    expect(log).toEqual(['stop:api', 'start:api', 'healthy:api'])
    api.crash(1)
    await tick()
    expect(api.starts).toBe(3)
  })
})

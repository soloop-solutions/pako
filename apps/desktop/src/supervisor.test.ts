import { describe, expect, it } from 'vitest'
import { ApiProcess } from './api'
import { NEWER_SCHEMA_EXIT_CODE, StartError, Supervisor, type ManagedChild } from './supervisor'
import type { ChildLike } from './types'
import { decideAfterStartFailure } from './upgrade'

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

  it('Supervisor_StartAll_TagsTheFailingStage', async () => {
    const log: string[] = []
    const pg = fakeChild('pg', log)
    pg.start = async () => {
      throw new Error('Postgres did not become ready in time')
    }
    await expect(new Supervisor({ pg, api: apiChild(log) }).startAll()).rejects.toMatchObject({ stage: 'pg' })

    const api = apiChild(log)
    api.start = async () => {
      throw new Error('spawn ENOENT')
    }
    await expect(new Supervisor({ pg: fakeChild('pg', log), api }).startAll()).rejects.toMatchObject({ stage: 'api-start' })

    const sick = apiChild(log)
    sick.waitHealthy = async () => {
      throw new Error('API did not become healthy in time')
    }
    const err = await new Supervisor({ pg: fakeChild('pg', log), api: sick }).startAll().catch((e) => e)
    expect(err).toBeInstanceOf(StartError)
    expect(err).toMatchObject({ stage: 'api-health', message: 'API did not become healthy in time' })
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

  it('Supervisor_ApiExitsDuringStartAll_RejectsApiHealth_WithoutRestartOrEvent', async () => {
    const log: string[] = []
    let spawns = 0
    const api = new ApiProcess({
      exePath: '/opt/api/Pako.Api',
      port: 6001,
      env: {},
      spawn: (): ChildLike => {
        spawns++
        return {
          pid: 1,
          on(event, cb) {
            if (event === 'exit') queueMicrotask(() => (cb as (code: number | null) => void)(1))
          },
          kill() {},
        }
      },
      fetch: async () => {
        throw new Error('refused')
      },
      now: () => 0,
      sleep: () => new Promise((r) => setTimeout(r, 1)),
    })
    const s = new Supervisor({ pg: fakeChild('pg', log), api })
    const events: unknown[] = []
    s.on('child-exited', (e) => events.push(e))

    const err = await s.startAll().catch((e) => e)
    await tick()

    expect(err).toBeInstanceOf(StartError)
    expect(err).toMatchObject({ stage: 'api-health' })
    expect(spawns).toBe(1)
    expect(events).toEqual([])
    const backup = { file: '/b/pre.pako-backup', createdAt: '', appVersion: '1', schemaVersion: '1', sizeBytes: 1 }
    expect(decideAfterStartFailure({ upgraded: true, safetyBackup: backup }, err)).toEqual({
      action: 'offer-restore',
      backup,
    })
  })

  it('Supervisor_ApiExitsWithTheNewerSchemaCode_RejectsApiNewerSchema', async () => {
    const log: string[] = []
    const api = new ApiProcess({
      exePath: '/opt/api/Pako.Api',
      port: 6001,
      env: {},
      spawn: (): ChildLike => ({
        pid: 1,
        on(event, cb) {
          if (event === 'exit') queueMicrotask(() => (cb as (code: number | null) => void)(NEWER_SCHEMA_EXIT_CODE))
        },
        kill() {},
      }),
      fetch: async () => {
        throw new Error('refused')
      },
      now: () => 0,
      sleep: () => new Promise((r) => setTimeout(r, 1)),
    })
    const s = new Supervisor({ pg: fakeChild('pg', log), api })
    const events: unknown[] = []
    s.on('child-exited', (e) => events.push(e))

    const err = await s.startAll().catch((e) => e)
    await tick()

    expect(NEWER_SCHEMA_EXIT_CODE).toBe(78)
    expect(err).toBeInstanceOf(StartError)
    expect(err).toMatchObject({ stage: 'api-newer-schema' })
    expect(events).toEqual([])
    const backup = { file: '/b/pre.pako-backup', createdAt: '', appVersion: '1', schemaVersion: '1', sizeBytes: 1 }
    expect(decideAfterStartFailure({ upgraded: true, safetyBackup: backup }, err)).toEqual({ action: 'newer-schema' })
  })

  it('Supervisor_PgExitsDuringStartAll_IsNotRestarted', async () => {
    const log: string[] = []
    const pg = fakeChild('pg', log)
    pg.start = async () => {
      pg.starts++
      pg.crash(1)
      throw new Error('Postgres exited with code 1 before it became ready')
    }
    const s = new Supervisor({ pg, api: apiChild(log) })
    const events: unknown[] = []
    s.on('child-exited', (e) => events.push(e))
    await expect(s.startAll()).rejects.toMatchObject({ stage: 'pg' })
    await tick()
    expect(pg.starts).toBe(1)
    expect(events).toEqual([])
  })
})

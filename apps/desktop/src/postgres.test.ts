import { describe, expect, it } from 'vitest'
import { PostgresProcess, type PgFs } from './postgres'
import type { ChildLike } from './types'

function fakeFs(files: Record<string, string>): PgFs & { removed: string[]; written: Record<string, string> } {
  const removed: string[] = []
  const written: Record<string, string> = {}
  return {
    removed,
    written,
    exists: async (p) => p in files,
    readFile: async (p) => files[p]!,
    writeFile: async (p, d) => {
      written[p] = d
      files[p] = d
    },
    rm: async (p) => {
      removed.push(p)
      delete files[p]
    },
    mkdir: async () => {},
  }
}

interface Call {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

type CodeFor = (cmd: string, args: string[], index: number) => number

function fakeSpawn(calls: Call[], codeFor: CodeFor = () => 0) {
  return (cmd: string, args: string[], o?: { env?: Record<string, string> }): ChildLike => {
    const index = calls.length
    calls.push({ cmd, args, env: o?.env })
    const long = cmd.endsWith('postgres')
    return {
      pid: 42,
      on(event, cb) {
        if (event === 'exit' && !long) queueMicrotask(() => (cb as (c: number) => void)(codeFor(cmd, args, index)))
      },
      kill() {},
    }
  }
}

const names = (calls: Call[]) => calls.map((c) => c.cmd.split('/').pop())

function make(
  files: Record<string, string>,
  calls: Call[],
  alive: (pid: number) => boolean,
  codeFor?: CodeFor,
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> },
) {
  const fs = fakeFs(files)
  const pg = new PostgresProcess({
    binDir: '/b',
    dataDir: '/d/pg',
    port: 5555,
    password: 'x-secret-pw',
    fs,
    isProcessAlive: alive,
    probe: async () => true,
    spawn: fakeSpawn(calls, codeFor),
    ...clock,
  })
  return { fs, pg }
}

describe('postgres', () => {
  it('Postgres_RemovesStalePidFile_WhenNoProcess', async () => {
    const calls: Call[] = []
    const { fs, pg } = make({ '/d/pg/postmaster.pid': '4242\n/d/pg\n' }, calls, () => false)
    await pg.start()
    expect(fs.removed).toContain('/d/pg/postmaster.pid')
    expect(names(calls)).not.toContain('pg_ctl')
  })

  it('Postgres_RefusesToDelete_PidFileOfLiveProcess', async () => {
    const calls: Call[] = []
    const { fs, pg } = make({ '/d/pg/postmaster.pid': '4242\n/d/pg\n' }, calls, (pid) => pid === 4242)
    await pg.start()
    expect(fs.removed).not.toContain('/d/pg/postmaster.pid')
    expect(names(calls).slice(0, 2)).toEqual(['pg_ctl', 'postgres'])
  })

  it('Postgres_LiveOrphanOfOurs_IsStopped_ThenStartProceeds', async () => {
    const calls: Call[] = []
    const { pg } = make({ '/d/pg/postmaster.pid': '4242\n/D/pg/\n' }, calls, (pid) => pid === 4242)
    await pg.start()
    const stop = calls[0]!
    expect(stop.cmd.endsWith('pg_ctl')).toBe(true)
    expect(stop.args).toEqual(['stop', '-D', '/d/pg', '-m', 'fast', '-w'])
    expect(names(calls)).toContain('postgres')
  })

  it('Postgres_PidReusedByUnrelatedProcess_IsTreatedAsStale', async () => {
    const calls: Call[] = []
    const { fs, pg } = make(
      { '/d/pg/postmaster.pid': '4242\n/other/dir\n' },
      calls,
      (pid) => pid === 4242,
      (_c, args) => (args[0] === 'status' ? 3 : 0),
    )
    await pg.start()
    expect(fs.removed).toContain('/d/pg/postmaster.pid')
    expect(calls.some((c) => c.args[0] === 'stop')).toBe(false)
    expect(names(calls)).toContain('postgres')
  })

  it('Postgres_StartArgs_UseMemorySettingsAndLoopback', async () => {
    const calls: Call[] = []
    const { pg } = make({}, calls, () => false)
    await pg.start()
    const joined = calls[0]!.args.join(' ')
    expect(joined).toContain('listen_addresses=127.0.0.1')
    expect(joined).toContain('shared_buffers=128MB')
    expect(joined).toContain('max_connections=50')
    expect(calls[0]!.args).toContain('5555')
  })

  it('Postgres_CreatesDatabase_IdempotentlyWithPasswordInEnvOnly', async () => {
    const calls: Call[] = []
    const { fs, pg } = make({}, calls, () => false)
    await pg.start()
    const psql = calls.find((c) => c.cmd.endsWith('psql'))!
    expect(psql.args.join(' ')).not.toContain('x-secret-pw')
    expect(psql.env?.PGPASSWORD).toBe('x-secret-pw')
    expect(psql.args).toContain('-f')
    const sql = Object.values(fs.written).find((d) => d.includes('CREATE DATABASE'))!
    expect(sql).toContain('UTF8')
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('\\gexec')
    expect(names(calls).indexOf('psql')).toBeGreaterThan(names(calls).indexOf('postgres'))

    await pg.start()
    expect(calls.filter((c) => c.cmd.endsWith('psql'))).toHaveLength(2)
  })

  it('Postgres_RetriesDatabaseCreate_WhileStartingUp_ThenSucceeds', async () => {
    const calls: Call[] = []
    let psqlRuns = 0
    let t = 0
    const { pg } = make(
      {},
      calls,
      () => false,
      (cmd) => (cmd.endsWith('psql') && ++psqlRuns < 3 ? 2 : 0),
      { now: () => t, sleep: async (ms) => void (t += ms) },
    )
    await pg.start()
    expect(calls.filter((c) => c.cmd.endsWith('psql'))).toHaveLength(3)
  })

  it('Postgres_DatabaseCreate_KeepsFailing_RejectsAfterWindow', async () => {
    const calls: Call[] = []
    let t = 0
    const { pg } = make(
      {},
      calls,
      () => false,
      (cmd) => (cmd.endsWith('psql') ? 2 : 0),
      { now: () => t, sleep: async (ms) => void (t += ms) },
    )
    await expect(pg.start()).rejects.toThrow(/accept connections|sessions/i)
    expect(calls.filter((c) => c.cmd.endsWith('psql')).length).toBeGreaterThan(1)
  })

  it('Postgres_DirMismatch_StatusZero_StopsAndKeepsPidFile', async () => {
    const calls: Call[] = []
    const { fs, pg } = make(
      { '/d/pg/postmaster.pid': '4242\n/private/d/pg\n' },
      calls,
      (pid) => pid === 4242,
    )
    await pg.start()
    expect(calls[0]!.args.slice(0, 3)).toEqual(['status', '-D', '/d/pg'])
    expect(calls[1]!.args).toEqual(['stop', '-D', '/d/pg', '-m', 'fast', '-w'])
    expect(fs.removed).not.toContain('/d/pg/postmaster.pid')
  })

  it('Postgres_DirMismatch_StatusNonZero_TreatedAsStale', async () => {
    const calls: Call[] = []
    const { fs, pg } = make(
      { '/d/pg/postmaster.pid': '4242\n/other/dir\n' },
      calls,
      (pid) => pid === 4242,
      (_c, args) => (args[0] === 'status' ? 3 : 0),
    )
    await pg.start()
    expect(fs.removed).toContain('/d/pg/postmaster.pid')
    expect(calls.some((c) => c.args[0] === 'stop')).toBe(false)
  })

  it('Postgres_WaitReady_RejectsFast_WhenTheServerExits', async () => {
    const calls: Call[] = []
    let probes = 0
    const pg = new PostgresProcess({
      binDir: '/b',
      dataDir: '/d/pg',
      port: 5555,
      password: 'pw',
      fs: fakeFs({}),
      isProcessAlive: () => false,
      probe: async () => {
        probes++
        return false
      },
      readyTimeoutMs: 600000,
      sleep: () => new Promise((r) => setTimeout(r, 1)),
      spawn: (cmd, args) => {
        calls.push({ cmd, args })
        return {
          pid: 42,
          on(event, cb) {
            if (event === 'exit') queueMicrotask(() => (cb as (c: number) => void)(1))
          },
          kill() {},
        }
      },
    })
    await expect(pg.start()).rejects.toThrow(/exited with code 1/)
    expect(probes).toBeLessThan(5)
    expect(names(calls)).not.toContain('psql')
  })

  it('Postgres_WaitReady_KillsTheServer_OnTimeout', async () => {
    const kills: number[] = []
    const pg = new PostgresProcess({
      binDir: '/b',
      dataDir: '/d/pg',
      port: 5555,
      password: 'pw',
      fs: fakeFs({}),
      isProcessAlive: () => false,
      probe: async () => false,
      readyTimeoutMs: 1000,
      sleep: async () => {},
      spawn: () => ({ pid: 42, on() {}, kill: () => void kills.push(42) }),
    })
    await expect(pg.start()).rejects.toThrow(/ready in time/)
    expect(kills).toEqual([42])
  })
})

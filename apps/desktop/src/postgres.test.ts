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

function fakeSpawn(calls: Call[]) {
  return (cmd: string, args: string[], o?: { env?: Record<string, string> }): ChildLike => {
    calls.push({ cmd, args, env: o?.env })
    const long = cmd.endsWith('postgres')
    return {
      pid: 42,
      on(event, cb) {
        if (event === 'exit' && !long) queueMicrotask(() => (cb as (c: number) => void)(0))
      },
      kill() {},
    }
  }
}

const names = (calls: Call[]) => calls.map((c) => c.cmd.split('/').pop())

function make(files: Record<string, string>, calls: Call[], alive: (pid: number) => boolean) {
  const fs = fakeFs(files)
  const pg = new PostgresProcess({
    binDir: '/b',
    dataDir: '/d/pg',
    port: 5555,
    password: 'x-secret-pw',
    fs,
    isProcessAlive: alive,
    probe: async () => true,
    spawn: fakeSpawn(calls),
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
    const { fs, pg } = make({ '/d/pg/postmaster.pid': '4242\n/other/dir\n' }, calls, (pid) => pid === 4242)
    await pg.start()
    expect(fs.removed).toContain('/d/pg/postmaster.pid')
    expect(names(calls)).not.toContain('pg_ctl')
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
})

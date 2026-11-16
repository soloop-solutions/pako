import { describe, expect, it } from 'vitest'
import { PostgresProcess, type PgFs } from './postgres'
import type { ChildLike } from './types'

function fakeFs(files: Record<string, string>): PgFs & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    exists: async (p) => p in files,
    readFile: async (p) => files[p]!,
    writeFile: async (p, d) => {
      files[p] = d
    },
    rm: async (p) => {
      removed.push(p)
      delete files[p]
    },
    mkdir: async () => {},
  }
}

function fakeChild(): ChildLike {
  return { pid: 42, on() {}, kill() {} }
}

describe('postgres', () => {
  it('Postgres_RemovesStalePidFile_WhenNoProcess', async () => {
    const fs = fakeFs({ '/d/pg/postmaster.pid': '4242\n/d/pg\n' })
    const pg = new PostgresProcess({
      binDir: '/b',
      dataDir: '/d/pg',
      port: 5555,
      password: 'x',
      fs,
      isProcessAlive: () => false,
      probe: async () => true,
      spawn: () => fakeChild(),
    })
    await pg.start()
    expect(fs.removed).toContain('/d/pg/postmaster.pid')
  })

  it('Postgres_RefusesToDelete_PidFileOfLiveProcess', async () => {
    const fs = fakeFs({ '/d/pg/postmaster.pid': '4242\n/d/pg\n' })
    const pg = new PostgresProcess({
      binDir: '/b',
      dataDir: '/d/pg',
      port: 5555,
      password: 'x',
      fs,
      isProcessAlive: (pid) => pid === 4242,
      probe: async () => true,
      spawn: () => fakeChild(),
    })
    await expect(pg.start()).rejects.toThrow(/already running/i)
    expect(fs.removed).toEqual([])
  })

  it('Postgres_StartArgs_UseMemorySettingsAndLoopback', async () => {
    const calls: { cmd: string; args: string[] }[] = []
    const pg = new PostgresProcess({
      binDir: '/b',
      dataDir: '/d/pg',
      port: 5555,
      password: 'x',
      fs: fakeFs({}),
      isProcessAlive: () => false,
      probe: async () => true,
      spawn: (cmd, args) => {
        calls.push({ cmd, args })
        return fakeChild()
      },
    })
    await pg.start()
    const joined = calls[0]!.args.join(' ')
    expect(joined).toContain('listen_addresses=127.0.0.1')
    expect(joined).toContain('shared_buffers=128MB')
    expect(joined).toContain('max_connections=50')
    expect(calls[0]!.args).toContain('5555')
  })
})

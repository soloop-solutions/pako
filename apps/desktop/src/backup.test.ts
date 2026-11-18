import { execFileSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyRetention, createBackup, listBackups, newestBackupAt, readSchemaVersion, restoreBackup } from './backup'
import { canRestore, readManifest } from './manifest'
import { getFreePort } from './ports'
import { PostgresProcess } from './postgres'
import { defaultSpawn } from './spawn'
import type { SpawnFn } from './types'

const pgBin = process.env.PAKO_TEST_PG_BIN ?? '/opt/homebrew/bin'
const hasPg = existsSync(path.join(pgBin, 'initdb')) || existsSync(path.join(pgBin, 'initdb.exe'))
const password = 'test-pw-ë'
const APP_SCHEMA = '20261116000000_Current'
const now = new Date(2026, 10, 18, 14, 30, 5)

let root = ''
let port = 0
let pg: PostgresProcess | undefined

function sql(database: string, query: string): string {
  return execFileSync(
    path.join(pgBin, 'psql'),
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { env: { ...process.env, PGPASSWORD: password, PGOPTIONS: '-c client_min_messages=warning' }, encoding: 'utf8' },
  ).trim()
}

function killing(tool: string, afterMs = 0, killed?: { at: number }): SpawnFn {
  return (command, args, options) => {
    const child = defaultSpawn(command, args, options)
    if (path.basename(command).replace(/\.exe$/i, '') !== tool) return child
    let exited = false
    child.on('exit', () => {
      exited = true
    })
    const kill = () => {
      if (exited) return
      if (killed) killed.at = Date.now()
      child.kill('SIGKILL')
    }
    if (afterMs === 0) kill()
    else setTimeout(kill, afterMs)
    return child
  }
}

const ok = { ok: true, failures: [] }

describe.skipIf(!hasPg)('backup and restore against real Postgres', () => {
  let db = ''
  let dir = ''
  let work = ''
  let calls: string[] = []

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pako-backup-test-'))
    port = await getFreePort()
    pg = new PostgresProcess({ binDir: pgBin, dataDir: path.join(root, 'pgdata'), port, password, database: 'postgres' })
    await pg.initIfNeeded()
    await pg.start()
  }, 120000)

  afterAll(async () => {
    if (pg) await pg.stop()
    await new Promise((r) => setTimeout(r, 500))
    await fs.rm(root, { recursive: true, force: true })
  }, 60000)

  beforeEach(async () => {
    db = `t_${Math.random().toString(36).slice(2, 10)}`
    sql('postgres', `CREATE DATABASE ${db} ENCODING 'UTF8' TEMPLATE template0`)
    sql(db, 'CREATE TABLE ledger (id int PRIMARY KEY, memo text NOT NULL)')
    sql(db, "INSERT INTO ledger VALUES (1, 'Fatura Çelik'), (2, 'Ëndrra sh.p.k.')")
    sql(db, 'CREATE TABLE "__EFMigrationsHistory" ("MigrationId" varchar(150) PRIMARY KEY, "ProductVersion" varchar(32) NOT NULL)')
    sql(db, `INSERT INTO "__EFMigrationsHistory" VALUES ('20261001000000_First', '10.0'), ('${APP_SCHEMA}', '10.0')`)
    dir = path.join(root, `backups-${db}`)
    work = path.join(root, `work-${db}`)
    await fs.mkdir(work, { recursive: true })
    calls = []
  })

  afterEach(() => {
    for (const name of [db, `${db}_restore`, `${db}_previous`, `${db}_failed`]) {
      sql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    }
  })

  const connection = () => ({ port, password, database: db })
  const rows = () => sql(db, "SELECT string_agg(id || ':' || memo, ',' ORDER BY id) FROM ledger")
  const databases = () => sql('postgres', `SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname LIKE '${db}%'`)

  const backup = (schemaVersion = APP_SCHEMA, at = now, destDir = dir, spawn?: SpawnFn) =>
    createBackup({ pgBinDir: pgBin, connection: connection(), destDir, appVersion: '1.0.0', schemaVersion, now: at, spawn })

  const restore = (file: string, over: Partial<Parameters<typeof restoreBackup>[0]> = {}) =>
    restoreBackup({
      file,
      pgBinDir: pgBin,
      connection: connection(),
      backupDir: dir,
      workDir: work,
      appVersion: '1.0.0',
      schemaVersion: APP_SCHEMA,
      now: new Date(2026, 10, 18, 15, 0, 0),
      stopApi: async () => {
        calls.push('stopApi')
      },
      startApi: async () => {
        calls.push('startApi')
      },
      verifyChain: async () => {
        calls.push('verify')
        return ok
      },
      ...over,
    })

  it('Backup_Then_Restore_RoundTripsData', async () => {
    const info = await backup()
    expect(path.basename(info.file)).toBe('pako-20261118-143005.pako-backup')
    expect(info.schemaVersion).toBe(APP_SCHEMA)
    expect(info.sizeBytes).toBeGreaterThan(0)
    const manifest = await readManifest(info.file)
    expect(manifest).toEqual({ appVersion: '1.0.0', schemaVersion: APP_SCHEMA, createdAt: now.toISOString() })

    sql(db, "DELETE FROM ledger WHERE id = 1; INSERT INTO ledger VALUES (3, 'later')")
    const result = await restore(info.file)

    expect(result).toEqual({ ok: true, verify: ok })
    expect(rows()).toBe('1:Fatura Çelik,2:Ëndrra sh.p.k.')
    expect(calls).toEqual(['stopApi', 'startApi', 'verify'])
    expect(databases()).toBe(db)
    const files = await listBackups(dir)
    expect(files).toHaveLength(2)
    const safety = files.find((f) => f.file !== info.file)!
    expect(path.basename(safety.file)).toBe('pako-20261118-150000.pako-backup')
    expect(await fs.readdir(work)).toEqual([])
  }, 60000)

  it('Restore_KeepsPreviousDatabase_WhenVerifyReportsBrokenChain', async () => {
    const info = await backup()
    const broken = { ok: false, failures: [{ companyId: 'c1', reason: 'EntryHashMismatch' }] }
    const result = await restore(info.file, { verifyChain: async () => broken })
    expect(result).toEqual({ ok: true, verify: broken })
    expect(databases()).toBe(`${db},${db}_previous`)
  }, 60000)

  it('Backup_IsAtomic_PartialFileNeverReplacesGoodOne', async () => {
    const good = await backup()
    const before = await fs.readFile(good.file)

    await expect(backup(APP_SCHEMA, now, dir, killing('pg_dump'))).rejects.toThrow(/pg_dump/)

    expect(await fs.readdir(dir)).toEqual([path.basename(good.file)])
    expect((await fs.readFile(good.file)).equals(before)).toBe(true)

    const second = await backup()
    expect(path.basename(second.file)).toBe('pako-20261118-143005-1.pako-backup')
    expect((await fs.readFile(good.file)).equals(before)).toBe(true)
  }, 60000)

  it('Restore_FailureLeavesOriginalDatabaseIntact', async () => {
    const info = await backup()
    sql(db, "UPDATE ledger SET memo = 'current' WHERE id = 1")

    const killed = await restore(info.file, { spawn: killing('pg_restore') })

    expect(killed.ok).toBe(false)
    expect(rows()).toBe('1:current,2:Ëndrra sh.p.k.')
    expect(calls).toEqual(['stopApi', 'startApi'])
    expect(databases()).toBe(db)
    expect(await fs.readdir(work)).toEqual([])
  }, 60000)

  it('Restore_SafetyBackupFails_ChangesNothing', async () => {
    const info = await backup()
    sql(db, "UPDATE ledger SET memo = 'current' WHERE id = 1")

    const result = await restore(info.file, { spawn: killing('pg_dump') })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/safety backup/)
    expect(rows()).toBe('1:current,2:Ëndrra sh.p.k.')
    expect(calls).toEqual(['stopApi', 'startApi'])
    expect(databases()).toBe(db)
    expect(await fs.readdir(dir)).toEqual([path.basename(info.file)])
  }, 60000)

  it('Restore_KilledMidway_LeavesOriginalIntact', async () => {
    sql(db, "INSERT INTO ledger SELECT g, repeat('x', 200) || g FROM generate_series(10, 400000) g")
    const info = await backup()
    sql(db, "DELETE FROM ledger WHERE id >= 10; UPDATE ledger SET memo = 'current' WHERE id = 1")
    const killed = { at: 0 }

    const result = await restore(info.file, { spawn: killing('pg_restore', 400, killed) })

    expect(killed.at).toBeGreaterThan(0)
    expect(result.ok).toBe(false)
    expect(rows()).toBe('1:current,2:\u00cbndrra sh.p.k.')
    expect(calls).toEqual(['stopApi', 'startApi'])
    expect(databases()).toBe(db)
  }, 120000)

  it('Restore_ApiFailsAfterSwap_RollsBackToOriginal', async () => {
    const info = await backup()
    sql(db, "UPDATE ledger SET memo = 'current' WHERE id = 1")
    let starts = 0

    const result = await restore(info.file, {
      startApi: async () => {
        starts++
        calls.push(`startApi:${rows()}`)
        if (starts === 1) throw new Error('migration failed')
      },
    })

    expect(result.ok).toBe(false)
    expect(rows()).toBe('1:current,2:Ëndrra sh.p.k.')
    expect(calls).toEqual([
      'stopApi',
      'startApi:1:Fatura Çelik,2:Ëndrra sh.p.k.',
      'stopApi',
      'startApi:1:current,2:Ëndrra sh.p.k.',
    ])
    expect(databases()).toBe(db)
  }, 60000)

  it('Restore_VerifyCallFails_RollsBackToOriginal', async () => {
    const info = await backup()
    sql(db, "UPDATE ledger SET memo = 'current' WHERE id = 1")

    const result = await restore(info.file, {
      verifyChain: async () => {
        throw new Error('verify unreachable')
      },
    })

    expect(result.ok).toBe(false)
    expect(rows()).toBe('1:current,2:Ëndrra sh.p.k.')
    expect(databases()).toBe(db)
  }, 60000)

  it('Restore_RefusesBackupNewerThanApp', async () => {
    const info = await backup('20990101000000_Future')
    sql(db, "UPDATE ledger SET memo = 'current' WHERE id = 1")

    const result = await restore(info.file)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/newer version of PAKO/)
    expect(rows()).toBe('1:current,2:Ëndrra sh.p.k.')
    expect(calls).toEqual([])
    expect(await fs.readdir(dir)).toEqual([path.basename(info.file)])
  }, 60000)

  it('Restore_OlderBackup_IsMigratedAfter', async () => {
    sql(db, `DELETE FROM "__EFMigrationsHistory" WHERE "MigrationId" = '${APP_SCHEMA}'`)
    const old = await backup(await readSchemaVersion({ pgBinDir: pgBin, connection: connection(), workDir: work }))
    expect(old.schemaVersion).toBe('20261001000000_First')
    sql(db, `INSERT INTO "__EFMigrationsHistory" VALUES ('${APP_SCHEMA}', '10.0')`)

    const result = await restore(old.file, {
      startApi: async () => {
        calls.push('startApi')
        sql(db, `INSERT INTO "__EFMigrationsHistory" VALUES ('${APP_SCHEMA}', '10.0')`)
      },
    })

    expect(result.ok).toBe(true)
    expect(calls).toEqual(['stopApi', 'startApi', 'verify'])
    expect(await readSchemaVersion({ pgBinDir: pgBin, connection: connection(), workDir: work })).toBe(APP_SCHEMA)
    expect(rows()).toBe('1:Fatura Çelik,2:Ëndrra sh.p.k.')
  }, 60000)

  it('Restore_RejectsFileThatIsNotABackup', async () => {
    const bogus = path.join(work, 'bogus.pako-backup')
    await fs.writeFile(bogus, 'not a zip')
    const result = await restore(bogus)
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
    await fs.rm(bogus)
  })

  it('Backup_WorksWithNonAsciiDestinationPath', async () => {
    const dest = path.join(root, 'Erion Avdiu', 'Ëndrra Çelik', 'kopje rezervë')
    const info = await backup(APP_SCHEMA, now, dest)
    expect(path.dirname(info.file)).toBe(dest)
    expect((await readManifest(info.file)).schemaVersion).toBe(APP_SCHEMA)
    expect((await listBackups(dest)).map((b) => b.file)).toEqual([info.file])
    sql(db, 'DELETE FROM ledger')
    const result = await restore(info.file, { backupDir: dest, workDir: path.join(dest, 'punë') })
    expect(result.ok).toBe(true)
    expect(rows()).toBe('1:Fatura Çelik,2:Ëndrra sh.p.k.')
  }, 60000)

  it('ReadSchemaVersion_IsEmpty_WhenNoMigrationsTable', async () => {
    sql(db, 'DROP TABLE "__EFMigrationsHistory"')
    expect(await readSchemaVersion({ pgBinDir: pgBin, connection: connection(), workDir: work })).toBe('')
  })
})

describe('canRestore', () => {
  it('refuses a newer schema and accepts equal or older ones', () => {
    const m = (schemaVersion: string) => ({ appVersion: '2.0.0', schemaVersion, createdAt: now.toISOString() })
    expect(canRestore(m('20270101000000_Next'), '1.0.0', APP_SCHEMA)).toEqual({ ok: false, reason: 'newer-than-app' })
    expect(canRestore(m(APP_SCHEMA), '1.0.0', APP_SCHEMA)).toEqual({ ok: true })
    expect(canRestore(m('20250101000000_Old'), '1.0.0', APP_SCHEMA)).toEqual({ ok: true })
    expect(canRestore(m(''), '1.0.0', APP_SCHEMA)).toEqual({ ok: true })
  })
})

describe('retention', () => {
  let rdir = ''
  const day = 24 * 60 * 60 * 1000
  const at = new Date(2026, 10, 18, 12, 0, 0)

  beforeEach(async () => {
    rdir = await fs.mkdtemp(path.join(os.tmpdir(), 'pako-retention-'))
  })

  afterEach(async () => {
    await fs.rm(rdir, { recursive: true, force: true })
  })

  const touch = (name: string) => fs.writeFile(path.join(rdir, name), 'x')

  it('Retention_KeepsNewest_EvenWhenAllExpired', async () => {
    await touch('pako-20260101-020000.pako-backup')
    await touch('pako-20260201-020000.pako-backup')
    await touch('pako-20260301-020000-1.pako-backup')
    await touch('notes.txt')
    await touch('pako-20250101-020000.pako-backup.bak')
    await fs.mkdir(path.join(rdir, 'pako-20240101-020000.pako-backup'))

    const deleted = await applyRetention(rdir, 30, at)

    expect(deleted.map((f) => path.basename(f)).sort()).toEqual([
      'pako-20260101-020000.pako-backup',
      'pako-20260201-020000.pako-backup',
    ])
    expect((await fs.readdir(rdir)).sort()).toEqual([
      'notes.txt',
      'pako-20240101-020000.pako-backup',
      'pako-20250101-020000.pako-backup.bak',
      'pako-20260301-020000-1.pako-backup',
    ])
  })

  it('Retention_DeletesOnlyExpiredBackups', async () => {
    await touch('pako-20261001-020000.pako-backup')
    await touch('pako-20261110-020000.pako-backup')
    await touch('pako-20261117-020000.pako-backup')

    const deleted = await applyRetention(rdir, 30, at)

    expect(deleted.map((f) => path.basename(f))).toEqual(['pako-20261001-020000.pako-backup'])
    expect(await newestBackupAt(rdir)).toEqual(new Date(2026, 10, 17, 2, 0, 0))
  })

  it('Retention_UsesModifiedTime_ForRenamedBackups', async () => {
    await touch('pako-20261117-020000.pako-backup')
    await touch('my copy.pako-backup')
    const old = new Date(at.getTime() - 90 * day)
    await fs.utimes(path.join(rdir, 'my copy.pako-backup'), old, old)

    const deleted = await applyRetention(rdir, 30, at)

    expect(deleted.map((f) => path.basename(f))).toEqual(['my copy.pako-backup'])
  })

  it('NewestBackupAt_IsNull_WhenDirectoryMissing', async () => {
    expect(await newestBackupAt(path.join(rdir, 'missing'))).toBeNull()
    expect(await applyRetention(path.join(rdir, 'missing'), 30, at)).toEqual([])
  })
})

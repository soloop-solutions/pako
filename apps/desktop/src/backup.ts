import { createWriteStream, promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import yazl from 'yazl'
import type { BackupInfo, RestoreResult } from '@pako/shared'
import {
  BACKUP_EXTENSION,
  DUMP_ENTRY,
  MANIFEST_ENTRY,
  backupFileName,
  canRestore,
  extractDump,
  parseBackupTime,
  readManifest,
  type BackupManifest,
} from './manifest'
import { defaultSpawn } from './spawn'
import type { SpawnFn } from './types'

export interface PgConnection {
  port: number
  password: string
  database: string
}

export interface VerifyResult {
  ok: boolean
  failures: { companyId: string; reason: string }[]
}

interface ToolContext {
  pgBinDir: string
  connection: PgConnection
  spawn?: SpawnFn
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,40}$/
const TEMP_PREFIX = '.pako-tmp-'

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe database name: ${name}`)
  return `"${name}"`
}

function runTool(ctx: ToolContext, tool: string, args: string[]): Promise<void> {
  const spawn = ctx.spawn ?? defaultSpawn
  const { port, password } = ctx.connection
  const child = spawn(
    path.join(ctx.pgBinDir, tool),
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', ...args],
    { env: { PGPASSWORD: password, PGCLIENTENCODING: 'UTF8' } },
  )
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${tool} exited with code ${code}`))))
  })
}

function psql(ctx: ToolContext, database: string, sql: string, extra: string[] = []): Promise<void> {
  return runTool(ctx, 'psql', ['-d', database, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra, '-c', sql])
}

async function query(ctx: ToolContext, workDir: string, database: string, sql: string): Promise<string> {
  const out = path.join(workDir, `${TEMP_PREFIX}${randomBytes(6).toString('hex')}.out`)
  try {
    await psql(ctx, database, sql, ['-tA', '-o', out])
    return (await fs.readFile(out, 'utf8')).trim()
  } finally {
    await fs.rm(out, { force: true })
  }
}

export async function readSchemaVersion(opts: ToolContext & { workDir: string }): Promise<string> {
  const db = opts.connection.database
  await fs.mkdir(opts.workDir, { recursive: true })
  const exists = await query(opts, opts.workDir, db, `SELECT to_regclass('public."__EFMigrationsHistory"') IS NOT NULL`)
  if (exists !== 't') return ''
  return query(opts, opts.workDir, db, `SELECT COALESCE(max("MigrationId"), '') FROM "__EFMigrationsHistory"`)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

async function writeZip(zipPath: string, dumpPath: string, manifest: BackupManifest): Promise<void> {
  const zip = new yazl.ZipFile()
  zip.addFile(dumpPath, DUMP_ENTRY, { compress: false })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), MANIFEST_ENTRY)
  const out = createWriteStream(zipPath, { flags: 'wx' })
  const done = new Promise<void>((resolve, reject) => {
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.outputStream.on('error', reject)
  })
  zip.outputStream.pipe(out)
  zip.end()
  await done
  const handle = await fs.open(zipPath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDir(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const handle = await fs.open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {}
}

async function uniqueTarget(destDir: string, now: Date): Promise<string> {
  for (let suffix = 0; ; suffix++) {
    const candidate = path.join(destDir, backupFileName(now, suffix))
    if (!(await exists(candidate))) return candidate
  }
}

export interface CreateBackupOptions extends ToolContext {
  destDir: string
  appVersion: string
  schemaVersion: string
  now: Date
}

export async function createBackup(opts: CreateBackupOptions): Promise<BackupInfo> {
  await fs.mkdir(opts.destDir, { recursive: true })
  const base = path.join(opts.destDir, `${TEMP_PREFIX}${randomBytes(8).toString('hex')}`)
  const dumpTmp = `${base}.dump`
  const zipTmp = `${base}.zip`
  const manifest: BackupManifest = {
    appVersion: opts.appVersion,
    schemaVersion: opts.schemaVersion,
    createdAt: opts.now.toISOString(),
  }
  let renamed = false
  try {
    await runTool(opts, 'pg_dump', ['-d', opts.connection.database, '-Fc', '-f', dumpTmp])
    await writeZip(zipTmp, dumpTmp, manifest)
    await readManifest(zipTmp)
    const target = await uniqueTarget(opts.destDir, opts.now)
    await fs.rename(zipTmp, target)
    renamed = true
    await syncDir(opts.destDir)
    const { size } = await fs.stat(target)
    return { file: target, ...manifest, sizeBytes: size }
  } finally {
    await fs.rm(dumpTmp, { force: true })
    if (!renamed) await fs.rm(zipTmp, { force: true })
  }
}

interface BackupFile {
  file: string
  time: Date
}

async function backupFiles(dir: string): Promise<BackupFile[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const result: BackupFile[] = []
  for (const name of names) {
    if (!name.endsWith(BACKUP_EXTENSION)) continue
    const file = path.join(dir, name)
    let stat
    try {
      stat = await fs.lstat(file)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    result.push({ file, time: parseBackupTime(name) ?? stat.mtime })
  }
  return result.sort((a, b) => b.time.getTime() - a.time.getTime() || b.file.localeCompare(a.file))
}

export async function newestBackupAt(dir: string): Promise<Date | null> {
  return (await backupFiles(dir))[0]?.time ?? null
}

export async function applyRetention(dir: string, days: number, now: Date): Promise<string[]> {
  const [, ...older] = await backupFiles(dir)
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000
  const deleted: string[] = []
  for (const { file, time } of older) {
    if (time.getTime() >= cutoff) continue
    await fs.rm(file)
    deleted.push(file)
  }
  return deleted
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const result: BackupInfo[] = []
  for (const { file } of await backupFiles(dir)) {
    try {
      const manifest = await readManifest(file)
      const { size } = await fs.stat(file)
      result.push({ file, ...manifest, sizeBytes: size })
    } catch {}
  }
  return result
}

export interface RestoreOptions extends ToolContext {
  file: string
  backupDir: string
  workDir: string
  appVersion: string
  schemaVersion: string
  now: Date
  stopApi(): Promise<void>
  startApi(): Promise<void>
  verifyChain(): Promise<VerifyResult>
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function dropDatabase(ctx: ToolContext, name: string): Promise<void> {
  await psql(ctx, 'postgres', `DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`)
}

async function swap(ctx: ToolContext, live: string, aside: string, incoming: string): Promise<void> {
  await psql(
    ctx,
    'postgres',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${live}', '${incoming}') AND pid <> pg_backend_pid()`,
  )
  await psql(
    ctx,
    'postgres',
    `ALTER DATABASE ${ident(live)} RENAME TO ${ident(aside)}; ALTER DATABASE ${ident(incoming)} RENAME TO ${ident(live)};`,
  )
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const live = opts.connection.database
  const scratch = `${live}_restore`
  const previous = `${live}_previous`
  const failed = `${live}_failed`
  ident(live)
  ident(scratch)
  ident(previous)
  ident(failed)

  let manifest: BackupManifest
  try {
    manifest = await readManifest(opts.file)
  } catch {
    return { ok: false, error: 'The selected file is not a valid PAKO backup.' }
  }
  if (!canRestore(manifest, opts.appVersion, opts.schemaVersion).ok) {
    return {
      ok: false,
      error: `This backup was made by a newer version of PAKO (${manifest.appVersion}). Install that version or newer to restore it.`,
    }
  }

  await fs.mkdir(opts.workDir, { recursive: true })
  const dump = path.join(opts.workDir, `${TEMP_PREFIX}${randomBytes(8).toString('hex')}.dump`)
  try {
    try {
      await extractDump(opts.file, dump)
    } catch (err) {
      return { ok: false, error: `The backup file could not be read: ${message(err)}` }
    }

    const abort = async (what: string, err: unknown): Promise<RestoreResult> => {
      await dropDatabase(opts, scratch).catch(() => {})
      const restarted = await opts.startApi().then(
        () => '',
        (e) => ` The app could not be restarted: ${message(e)}`,
      )
      return { ok: false, error: `${what}, nothing was changed: ${message(err)}.${restarted}` }
    }

    try {
      await opts.stopApi()
    } catch (err) {
      return abort('The app could not be paused for the restore', err)
    }

    let safety: BackupInfo
    try {
      safety = await createBackup({ ...opts, destDir: opts.backupDir, schemaVersion: opts.schemaVersion })
    } catch (err) {
      return abort('Could not take a safety backup', err)
    }

    try {
      await dropDatabase(opts, scratch)
      await psql(opts, 'postgres', `CREATE DATABASE ${ident(scratch)} ENCODING 'UTF8' TEMPLATE template0`)
      await runTool(opts, 'pg_restore', ['-d', scratch, '--exit-on-error', '--no-owner', '--no-acl', dump])
    } catch (err) {
      return abort('The backup could not be restored', err)
    }

    try {
      await dropDatabase(opts, previous)
      await swap(opts, live, previous, scratch)
    } catch (err) {
      return abort('The restore could not be completed', err)
    }

    let verify: VerifyResult
    try {
      await opts.startApi()
      verify = await opts.verifyChain()
    } catch (err) {
      return rollback(opts, live, previous, failed, safety, message(err))
    }

    if (verify.ok) await dropDatabase(opts, previous).catch(() => {})
    return { ok: true, verify }
  } finally {
    await fs.rm(dump, { force: true })
  }
}

async function rollback(
  opts: RestoreOptions,
  live: string,
  previous: string,
  failed: string,
  safety: BackupInfo,
  reason: string,
): Promise<RestoreResult> {
  try {
    await opts.stopApi().catch(() => {})
    await dropDatabase(opts, failed)
    await swap(opts, live, failed, previous)
  } catch (err) {
    return {
      ok: false,
      error: `The restore failed (${reason}) and the previous data could not be put back automatically (${message(err)}). Your data is safe in the safety backup ${safety.file}.`,
    }
  }
  await dropDatabase(opts, failed).catch(() => {})
  try {
    await opts.startApi()
  } catch (err) {
    return {
      ok: false,
      error: `The restore failed (${reason}). Your previous data was put back, but the app could not be restarted: ${message(err)}`,
    }
  }
  return { ok: false, error: `The restore failed and your previous data was put back: ${reason}` }
}

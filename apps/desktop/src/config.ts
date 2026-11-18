import { promises as nodeFs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { DesktopPaths } from './paths'

export interface DesktopConfig {
  jwtKey: string
  pgPassword: string
  backupDir: string
  retentionDays: number
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface ConfigFs {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface ConfigDeps {
  fs?: ConfigFs
  safeStorage?: SafeStorageLike
  randomHex?: (bytes: number) => string
}

interface StoredConfig {
  encrypted: boolean
  jwtKey: string
  pgPassword: string
  backupDir: string
  retentionDays: number
}

const realFs: ConfigFs = {
  exists: async (p) => {
    try {
      await nodeFs.access(p)
      return true
    } catch {
      return false
    }
  },
  readFile: (p) => nodeFs.readFile(p, 'utf8'),
  writeFile: (p, d) => nodeFs.writeFile(p, d, 'utf8'),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true })
  },
}

export const DEFAULT_RETENTION_DAYS = 30

export function validRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

const defaultRandomHex = (bytes: number) => randomBytes(bytes).toString('hex')

export async function loadOrCreateConfig(
  paths: DesktopPaths,
  deps: ConfigDeps = {},
): Promise<DesktopConfig> {
  const fs = deps.fs ?? realFs
  const safe = deps.safeStorage
  const randomHex = deps.randomHex ?? defaultRandomHex
  const useEncryption = safe?.isEncryptionAvailable() === true

  const seal = (value: string) =>
    useEncryption ? safe!.encryptString(value).toString('base64') : value
  const open = (value: string, encrypted: boolean) =>
    encrypted ? safe!.decryptString(Buffer.from(value, 'base64')) : value

  if (await fs.exists(paths.configFile)) {
    const stored = JSON.parse(await fs.readFile(paths.configFile)) as StoredConfig
    if (stored.encrypted && !useEncryption) {
      throw new Error('Config is encrypted but secure storage is unavailable')
    }
    return {
      jwtKey: open(stored.jwtKey, stored.encrypted),
      pgPassword: open(stored.pgPassword, stored.encrypted),
      backupDir:
        typeof stored.backupDir === 'string' && stored.backupDir.length > 0 ? stored.backupDir : paths.backupsDefault,
      retentionDays: validRetentionDays(stored.retentionDays) ? stored.retentionDays : DEFAULT_RETENTION_DAYS,
    }
  }

  const created: DesktopConfig = {
    jwtKey: randomHex(48),
    pgPassword: randomHex(24),
    backupDir: paths.backupsDefault,
    retentionDays: DEFAULT_RETENTION_DAYS,
  }
  const stored: StoredConfig = {
    encrypted: useEncryption,
    jwtKey: seal(created.jwtKey),
    pgPassword: seal(created.pgPassword),
    backupDir: created.backupDir,
    retentionDays: created.retentionDays,
  }
  await fs.mkdir(paths.dataDir)
  await fs.writeFile(paths.configFile, JSON.stringify(stored, null, 2))
  return created
}

export async function saveBackupDir(paths: DesktopPaths, backupDir: string): Promise<void> {
  const stored = JSON.parse(await nodeFs.readFile(paths.configFile, 'utf8')) as StoredConfig
  const tmp = `${paths.configFile}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await nodeFs.writeFile(tmp, JSON.stringify({ ...stored, backupDir }, null, 2), { encoding: 'utf8', mode: 0o600 })
    await nodeFs.rename(tmp, paths.configFile)
  } finally {
    await nodeFs.rm(tmp, { force: true })
  }
}

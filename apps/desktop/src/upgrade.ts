import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { BackupInfo } from '@pako/shared'
import { StartError } from './supervisor'

export interface UpgradeState {
  upgraded: boolean
  safetyBackup?: BackupInfo
}

interface PendingUpgrade {
  fromVersion: string
  toVersion: string
  backupFile: string
  backup: BackupInfo
}

const versionFile = (dataDir: string) => path.join(dataDir, 'version.json')
const pendingFile = (dataDir: string) => path.join(dataDir, 'pending-upgrade.json')

async function writeAtomic(dataDir: string, target: string, value: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  const tmp = path.join(dataDir, `.upgrade-${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(tmp, target)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export async function readInstalledVersion(dataDir: string): Promise<string | null> {
  let raw: string
  try {
    raw = await fs.readFile(versionFile(dataDir), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { appVersion?: unknown }
    return typeof parsed.appVersion === 'string' ? parsed.appVersion : ''
  } catch {
    return ''
  }
}

async function readPending(dataDir: string): Promise<PendingUpgrade | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(pendingFile(dataDir), 'utf8')) as PendingUpgrade
    if (
      typeof parsed.fromVersion !== 'string' ||
      typeof parsed.toVersion !== 'string' ||
      typeof parsed.backupFile !== 'string' ||
      parsed.backup?.file !== parsed.backupFile
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}

export async function prepareUpgrade(opts: {
  dataDir: string
  appVersion: string
  hasDatabase: boolean
  backup: () => Promise<BackupInfo>
}): Promise<UpgradeState> {
  const installed = await readInstalledVersion(opts.dataDir)
  if (installed === opts.appVersion) return { upgraded: false }
  if (installed === null && !opts.hasDatabase) return { upgraded: false }
  const fromVersion = installed ?? ''
  const pending = await readPending(opts.dataDir)
  if (
    pending &&
    pending.fromVersion === fromVersion &&
    pending.toVersion === opts.appVersion &&
    (await fileExists(pending.backupFile))
  ) {
    return { upgraded: true, safetyBackup: pending.backup }
  }
  const backup = await opts.backup()
  const record: PendingUpgrade = { fromVersion, toVersion: opts.appVersion, backupFile: backup.file, backup }
  await writeAtomic(opts.dataDir, pendingFile(opts.dataDir), record)
  return { upgraded: true, safetyBackup: backup }
}

export async function markVersion(dataDir: string, appVersion: string): Promise<void> {
  await writeAtomic(dataDir, versionFile(dataDir), { appVersion })
  await fs.rm(pendingFile(dataDir), { force: true })
}

export type StartFailureDecision =
  | { action: 'offer-restore'; backup: BackupInfo }
  | { action: 'newer-schema' }
  | { action: 'fatal' }

export const NEWER_SCHEMA_DIALOG = {
  message: 'This data was created by a newer version of PAKO.',
  detail: 'Install the current version, or restore an older backup.',
  buttons: ['Open log folder', 'Close'],
} as const

export function decideAfterStartFailure(state: UpgradeState | undefined, error: unknown): StartFailureDecision {
  if (error instanceof StartError && error.stage === 'api-newer-schema') return { action: 'newer-schema' }
  const migrationStage = error instanceof StartError && error.stage === 'api-health'
  if (migrationStage && state?.upgraded && state.safetyBackup) return { action: 'offer-restore', backup: state.safetyBackup }
  return { action: 'fatal' }
}

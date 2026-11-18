import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { BackupInfo } from '@pako/shared'

export interface UpgradeState {
  upgraded: boolean
  safetyBackup?: BackupInfo
}

const versionFile = (dataDir: string) => path.join(dataDir, 'version.json')

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

export async function prepareUpgrade(opts: {
  dataDir: string
  appVersion: string
  hasDatabase: boolean
  backup: () => Promise<BackupInfo>
}): Promise<UpgradeState> {
  const installed = await readInstalledVersion(opts.dataDir)
  if (installed === opts.appVersion) return { upgraded: false }
  if (installed === null && !opts.hasDatabase) return { upgraded: false }
  return { upgraded: true, safetyBackup: await opts.backup() }
}

export async function markVersion(dataDir: string, appVersion: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  const tmp = path.join(dataDir, `.version-${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, JSON.stringify({ appVersion }, null, 2), 'utf8')
    await fs.rename(tmp, versionFile(dataDir))
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export type StartFailureDecision = { action: 'offer-restore'; backup: BackupInfo } | { action: 'fatal' }

export function decideAfterStartFailure(state: UpgradeState | undefined): StartFailureDecision {
  if (state?.upgraded && state.safetyBackup) return { action: 'offer-restore', backup: state.safetyBackup }
  return { action: 'fatal' }
}

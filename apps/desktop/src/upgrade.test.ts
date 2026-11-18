import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupInfo } from '@pako/shared'
import { decideAfterStartFailure, markVersion, prepareUpgrade, readInstalledVersion } from './upgrade'

const info: BackupInfo = {
  file: '/b/pako-20261118-090000.pako-backup',
  createdAt: '2026-11-18T09:00:00.000Z',
  appVersion: '1.0.0',
  schemaVersion: '20261116000000_X',
  sizeBytes: 10,
}

describe('upgrade', () => {
  let dataDir = ''
  let log: string[] = []
  const backup = async () => {
    log.push('backup')
    return info
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pako-upgrade-'))
    log = []
  })

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true })
  })

  it('Upgrade_TakesBackupBeforeFirstLaunchOfNewVersion', async () => {
    await markVersion(dataDir, '1.0.0')

    const result = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })

    expect(result).toEqual({ upgraded: true, safetyBackup: info })
    expect(log).toEqual(['backup'])
    expect(await readInstalledVersion(dataDir)).toBe('1.0.0')
    await markVersion(dataDir, '1.1.0')
    expect(await readInstalledVersion(dataDir)).toBe('1.1.0')
    expect(await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })).toEqual({ upgraded: false })
    expect(log).toEqual(['backup'])
  })

  it('Upgrade_TakesBackup_WhenVersionFileMissingButDatabaseExists', async () => {
    const result = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })
    expect(result.upgraded).toBe(true)
    expect(log).toEqual(['backup'])
  })

  it('Upgrade_NoBackup_WhenVersionUnchanged', async () => {
    await markVersion(dataDir, '1.1.0')
    expect(await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })).toEqual({ upgraded: false })
    expect(log).toEqual([])
  })

  it('Upgrade_NoBackup_OnFreshInstall', async () => {
    expect(await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: false, backup })).toEqual({ upgraded: false })
    expect(log).toEqual([])
  })

  it('Upgrade_BackupFailure_Propagates_AndVersionIsNotWritten', async () => {
    await markVersion(dataDir, '1.0.0')
    const failing = async (): Promise<BackupInfo> => {
      throw new Error('disk full')
    }
    await expect(prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: failing })).rejects.toThrow('disk full')
    expect(await readInstalledVersion(dataDir)).toBe('1.0.0')
  })

  it('Upgrade_CorruptVersionFile_IsTreatedAsUpgrade', async () => {
    await fs.writeFile(path.join(dataDir, 'version.json'), '{nope')
    const result = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })
    expect(result.upgraded).toBe(true)
  })

  it('MarkVersion_LeavesNoTempFiles', async () => {
    await markVersion(dataDir, '1.1.0')
    expect(await fs.readdir(dataDir)).toEqual(['version.json'])
  })
})

describe('decideAfterStartFailure', () => {
  it('offers the pre-upgrade backup only after an upgrade that took one', () => {
    expect(decideAfterStartFailure({ upgraded: true, safetyBackup: info })).toEqual({ action: 'offer-restore', backup: info })
    expect(decideAfterStartFailure({ upgraded: false })).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure({ upgraded: true })).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure(undefined)).toEqual({ action: 'fatal' })
  })
})

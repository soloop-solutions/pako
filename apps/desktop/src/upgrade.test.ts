import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupInfo } from '@pako/shared'
import { StartError } from './supervisor'
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

  it('Upgrade_SecondLaunchAfterFailedFirst_ReusesTheFirstBackup', async () => {
    await markVersion(dataDir, '1.0.0')
    const b1 = { ...info, file: path.join(dataDir, 'b1.pako-backup') }
    await fs.writeFile(b1.file, 'x')
    let n = 0
    const counting = async () => {
      n++
      return n === 1 ? b1 : { ...info, file: path.join(dataDir, 'b2.pako-backup') }
    }

    const first = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: counting })
    const second = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: counting })

    expect(n).toBe(1)
    expect(first.safetyBackup).toEqual(b1)
    expect(second).toEqual({ upgraded: true, safetyBackup: b1 })
    const pending = JSON.parse(await fs.readFile(path.join(dataDir, 'pending-upgrade.json'), 'utf8'))
    expect(pending).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.1.0', backupFile: b1.file })
  })

  it('Upgrade_PendingForADifferentTarget_TakesANewBackup', async () => {
    await markVersion(dataDir, '1.0.0')
    const old = { ...info, file: path.join(dataDir, 'old.pako-backup') }
    await fs.writeFile(old.file, 'x')
    await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: async () => old })

    const result = await prepareUpgrade({ dataDir, appVersion: '1.2.0', hasDatabase: true, backup })

    expect(log).toEqual(['backup'])
    expect(result.safetyBackup).toEqual(info)
  })

  it('Upgrade_PendingBackupFileMissing_TakesANewBackup', async () => {
    await markVersion(dataDir, '1.0.0')
    await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: async () => ({ ...info, file: path.join(dataDir, 'gone.pako-backup') }) })

    const result = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })

    expect(log).toEqual(['backup'])
    expect(result.safetyBackup).toEqual(info)
  })

  it('Upgrade_PendingIsDiscarded_WhenTheOldVersionRunsAgain', async () => {
    await markVersion(dataDir, '1.0.0')
    const b1 = { ...info, file: path.join(dataDir, 'b1.pako-backup') }
    await fs.writeFile(b1.file, 'x')
    await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: async () => b1 })

    expect(await prepareUpgrade({ dataDir, appVersion: '1.0.0', hasDatabase: true, backup })).toEqual({ upgraded: false })
    expect(await fs.readdir(dataDir)).toContain('pending-upgrade.json')
    await markVersion(dataDir, '1.0.0')
    const later = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })

    expect(log).toEqual(['backup'])
    expect(later.safetyBackup).toEqual(info)
  })

  it('Upgrade_OldVersionReinstalledAndFailing_KeepsOfferingTheFirstBackup', async () => {
    await markVersion(dataDir, '1.0.0')
    const b1 = { ...info, file: path.join(dataDir, 'b1.pako-backup') }
    await fs.writeFile(b1.file, 'x')
    await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup: async () => b1 })

    expect(await prepareUpgrade({ dataDir, appVersion: '1.0.0', hasDatabase: true, backup })).toEqual({ upgraded: false })
    const again = await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })

    expect(log).toEqual([])
    expect(again).toEqual({ upgraded: true, safetyBackup: b1 })
  })

  it('MarkVersion_ClearsPendingUpgrade', async () => {
    await markVersion(dataDir, '1.0.0')
    await prepareUpgrade({ dataDir, appVersion: '1.1.0', hasDatabase: true, backup })
    expect(await fs.readdir(dataDir)).toContain('pending-upgrade.json')

    await markVersion(dataDir, '1.1.0')

    expect(await fs.readdir(dataDir)).toEqual(['version.json'])
  })

  it('MarkVersion_LeavesNoTempFiles', async () => {
    await markVersion(dataDir, '1.1.0')
    expect(await fs.readdir(dataDir)).toEqual(['version.json'])
  })
})

describe('decideAfterStartFailure', () => {
  const health = new StartError('api-health', 'API did not become healthy in time')

  it('offers the pre-upgrade backup only after an upgrade that took one', () => {
    expect(decideAfterStartFailure({ upgraded: true, safetyBackup: info }, health)).toEqual({ action: 'offer-restore', backup: info })
    expect(decideAfterStartFailure({ upgraded: false }, health)).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure({ upgraded: true }, health)).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure(undefined, health)).toEqual({ action: 'fatal' })
  })

  it('Upgrade_PostgresStartFailure_DoesNotOfferRestore', () => {
    const state = { upgraded: true, safetyBackup: info }
    expect(decideAfterStartFailure(state, new StartError('pg', 'Postgres did not become ready in time'))).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure(state, new StartError('api-start', 'spawn ENOENT'))).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure(state, new Error('other'))).toEqual({ action: 'fatal' })
    expect(decideAfterStartFailure(state, 'string')).toEqual({ action: 'fatal' })
  })
})

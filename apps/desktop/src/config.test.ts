import { promises as nodeFs } from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateConfig, saveApiPort, saveBackupDir, type ConfigFs, type SafeStorageLike } from './config'
import { resolvePaths } from './paths'

function memFs(): ConfigFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    exists: async (p) => files.has(p),
    readFile: async (p) => files.get(p)!,
    writeFile: async (p, d) => {
      files.set(p, d)
    },
    mkdir: async () => {},
  }
}

const reversing: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...s].reverse().join('')),
  decryptString: (b) => [...b.toString()].reverse().join(''),
}

describe('config', () => {
  it('Config_CreatedOnce_AndStableAcrossLoads', async () => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    const first = await loadOrCreateConfig(paths, { fs, safeStorage: reversing })
    const second = await loadOrCreateConfig(paths, { fs, safeStorage: reversing })
    expect(second).toEqual(first)
    expect(first.jwtKey.length).toBeGreaterThanOrEqual(64)
    expect('launchSecret' in first).toBe(false)
    expect(fs.files.get(paths.configFile)!).not.toContain('launchSecret')
    expect(first.retentionDays).toBeGreaterThan(0)
    const raw = fs.files.get(paths.configFile)!
    expect(raw).not.toContain(first.jwtKey)
    expect(raw).not.toContain(first.pgPassword)
  })

  it('Config_StoresPlainWhenEncryptionUnavailable', async () => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    const none: SafeStorageLike = { ...reversing, isEncryptionAvailable: () => false }
    const first = await loadOrCreateConfig(paths, { fs, safeStorage: none })
    const second = await loadOrCreateConfig(paths, { fs, safeStorage: none })
    expect(second).toEqual(first)
  })

  it('Config_SaveBackupDir_KeepsSecretsAndWritesAtomically', async () => {
    const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'pako-config-'))
    try {
      const paths = resolvePaths(root)
      const first = await loadOrCreateConfig(paths, { safeStorage: reversing })
      const dest = nodePath.join(root, 'Kopje \u00cbndrra')
      await saveBackupDir(paths, dest)
      const again = await loadOrCreateConfig(paths, { safeStorage: reversing })
      expect(again).toEqual({ ...first, backupDir: dest })
      expect((await nodeFs.readdir(root)).sort()).toEqual(['config.json'])
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing', undefined],
    ['non-numeric', 'thirty'],
    ['NaN', null],
    ['zero', 0],
    ['negative', -5],
    ['fractional', 2.5],
  ])('Config_InvalidRetentionDays_%s_FallsBackTo30', async (_label, value) => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    const stored: Record<string, unknown> = { encrypted: false, jwtKey: 'j', pgPassword: 'p', backupDir: '/b' }
    if (value !== undefined) stored.retentionDays = value
    fs.files.set(paths.configFile, JSON.stringify(stored))
    const config = await loadOrCreateConfig(paths, { fs })
    expect(config.retentionDays).toBe(30)
    expect(config.backupDir).toBe('/b')
  })

  it('Config_ValidRetentionDays_AndMissingBackupDir', async () => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    fs.files.set(paths.configFile, JSON.stringify({ encrypted: false, jwtKey: 'j', pgPassword: 'p', retentionDays: 7 }))
    const config = await loadOrCreateConfig(paths, { fs })
    expect(config.retentionDays).toBe(7)
    expect(config.backupDir).toBe(paths.backupsDefault)
  })

  it('Config_OldFileWithoutApiPort_Loads', async () => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    fs.files.set(paths.configFile, JSON.stringify({ encrypted: false, jwtKey: 'j', pgPassword: 'p', backupDir: '/b', retentionDays: 7 }))
    const config = await loadOrCreateConfig(paths, { fs })
    expect(config.apiPort).toBeUndefined()
    expect(config).toMatchObject({ jwtKey: 'j', pgPassword: 'p', backupDir: '/b', retentionDays: 7 })
  })

  it.each([
    ['string', '5123'],
    ['zero', 0],
    ['too high', 70000],
    ['privileged', 80],
    ['fractional', 5000.5],
  ])('Config_InvalidApiPort_%s_IsIgnored', async (_label, value) => {
    const fs = memFs()
    const paths = resolvePaths('/data/app')
    fs.files.set(paths.configFile, JSON.stringify({ encrypted: false, jwtKey: 'j', pgPassword: 'p', apiPort: value }))
    expect((await loadOrCreateConfig(paths, { fs })).apiPort).toBeUndefined()
  })

  it('Config_SaveApiPort_KeepsOtherFields_AndWritesAtomically', async () => {
    const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'pako-config-'))
    try {
      const paths = resolvePaths(root)
      const first = await loadOrCreateConfig(paths, { safeStorage: reversing })
      await saveBackupDir(paths, nodePath.join(root, 'b'))
      await saveApiPort(paths, 51234)
      const again = await loadOrCreateConfig(paths, { safeStorage: reversing })
      expect(again).toEqual({ ...first, backupDir: nodePath.join(root, 'b'), apiPort: 51234 })
      expect((await nodeFs.readdir(root)).sort()).toEqual(['config.json'])
      const raw = JSON.parse(await nodeFs.readFile(paths.configFile, 'utf8')) as Record<string, unknown>
      expect(raw.encrypted).toBe(true)
      expect(raw.jwtKey).not.toBe(first.jwtKey)
    } finally {
      await nodeFs.rm(root, { recursive: true, force: true })
    }
  })
})

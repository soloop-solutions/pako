import { promises as nodeFs } from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOrCreateConfig, saveBackupDir, type ConfigFs, type SafeStorageLike } from './config'
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
})

import { describe, expect, it } from 'vitest'
import { loadOrCreateConfig, type ConfigFs, type SafeStorageLike } from './config'
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
})

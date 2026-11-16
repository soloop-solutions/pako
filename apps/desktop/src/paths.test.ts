import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import { resolvePaths } from './paths'
import { PostgresProcess } from './postgres'

describe('paths', () => {
  it('Paths_WorkWithSpacesAndNonAscii', async () => {
    const appData = 'C:\\Users\\Erion Avdiu\\AppData\\Roaming\\Çelik Ëndrra'
    const p = resolvePaths(appData, win32)
    expect(p.pgData).toBe(win32.join(appData, 'pgdata'))
    expect(p.configFile.startsWith(appData)).toBe(true)

    const calls: { cmd: string; args: string[] }[] = []
    const pg = new PostgresProcess({
      binDir: 'C:\\Program Files\\Pako\\pg\\bin',
      dataDir: p.pgData,
      port: 5555,
      password: 'hunter-two',
      pathModule: win32,
      fs: {
        exists: async () => false,
        readFile: async () => '',
        writeFile: async () => {},
        rm: async () => {},
        mkdir: async () => {},
      },
      spawn: (cmd, args) => {
        calls.push({ cmd, args })
        return {
          pid: 1,
          on(event, cb) {
            if (event === 'exit') queueMicrotask(() => (cb as (c: number) => void)(0))
          },
          kill() {},
        }
      },
    })
    await pg.initIfNeeded()
    const initdb = calls[0]!
    expect(Array.isArray(initdb.args)).toBe(true)
    expect(initdb.args).toContain(p.pgData)
    expect(initdb.args).toContain('--encoding=UTF8')
    expect(initdb.args.join(' ')).not.toContain('hunter-two')
    expect(initdb.args.some((a) => a.startsWith('--pwfile='))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { ApiProcess, buildApiEnv } from './api'
import type { ChildLike } from './types'

function make(fetchImpl: (url: string) => Promise<{ status: number }>, now: () => number) {
  const calls: { cmd: string; args: string[]; env?: Record<string, string> }[] = []
  const api = new ApiProcess({
    exePath: 'C:\\Program Files\\Pako\\api\\Pako.Api.exe',
    port: 6001,
    env: { Desktop__Enabled: 'true' },
    spawn: (cmd, args, o) => {
      calls.push({ cmd, args, env: o?.env })
      const c: ChildLike = { pid: 1, on() {}, kill() {} }
      return c
    },
    fetch: fetchImpl,
    now,
    sleep: async () => {},
  })
  return { api, calls }
}

describe('api', () => {
  it('Api_WaitHealthy_PollsUntil200', async () => {
    let n = 0
    const urls: string[] = []
    const { api } = make(
      async (u) => {
        urls.push(u)
        return { status: ++n < 3 ? 503 : 200 }
      },
      () => 0,
    )
    await api.start()
    await api.waitHealthy(1000)
    expect(n).toBe(3)
    expect(urls[0]).toBe('http://127.0.0.1:6001/healthz')
  })

  it('Api_WaitHealthy_TimesOut', async () => {
    let t = 0
    const { api } = make(
      async () => {
        throw new Error('refused')
      },
      () => (t += 400),
    )
    await api.start()
    await expect(api.waitHealthy(1000)).rejects.toThrow(/healthy/i)
  })

  it('Api_Start_SpawnsExeWithEmptyArgsAndEnv', async () => {
    const { api, calls } = make(async () => ({ status: 200 }), () => 0)
    await api.start()
    expect(calls[0]!.cmd).toBe('C:\\Program Files\\Pako\\api\\Pako.Api.exe')
    expect(calls[0]!.args).toEqual([])
    expect(calls[0]!.env?.Desktop__Enabled).toBe('true')
  })

  it('Api_Start_RunsFromTheExeFolder_SoWwwrootIsFound', async () => {
    const calls: { cwd?: string }[] = []
    const api = new ApiProcess({
      exePath: '/opt/PAKO/resources/api/Pako.Api',
      port: 6001,
      env: {},
      spawn: (_cmd, _args, o) => {
        calls.push({ cwd: o?.cwd })
        return { pid: 1, on() {}, kill() {} }
      },
    })
    await api.start()
    expect(calls[0]!.cwd).toBe('/opt/PAKO/resources/api')
  })

  it('Api_Env_PassesTheDataDirectory', () => {
    const env = buildApiEnv({
      port: 6001,
      pgPort: 6002,
      pgPassword: 'pw',
      jwtKey: 'k',
      launchSecret: 's',
      dataDir: 'C:\\Users\\Çelik Ëndrra\\AppData\\Roaming\\PAKO',
    })
    expect(env.Desktop__DataDirectory).toBe('C:\\Users\\Çelik Ëndrra\\AppData\\Roaming\\PAKO')
    expect(env.Desktop__Enabled).toBe('true')
    expect(env.ASPNETCORE_ENVIRONMENT).toBe('Production')
  })

  it('Api_WaitHealthy_RejectsPromptly_WhenTheChildExits', async () => {
    let exit: ((code: number | null) => void) | undefined
    let fetches = 0
    const api = new ApiProcess({
      exePath: '/opt/api/Pako.Api',
      port: 6001,
      env: {},
      spawn: (): ChildLike => ({
        pid: 1,
        on(event, cb) {
          if (event === 'exit') exit = cb as (code: number | null) => void
        },
        kill() {},
      }),
      fetch: async () => {
        fetches++
        throw new Error('refused')
      },
      now: () => 0,
      sleep: () => new Promise((r) => setTimeout(r, 1)),
    })
    await api.start()
    exit!(3)
    await expect(api.waitHealthy(60000)).rejects.toThrow(/exited with code 3/)
    expect(fetches).toBeLessThanOrEqual(1)
  })

  it('Api_WaitHealthy_KillsTheChild_OnTimeout', async () => {
    const kills: (string | undefined)[] = []
    let t = 0
    const api = new ApiProcess({
      exePath: '/opt/api/Pako.Api',
      port: 6001,
      env: {},
      spawn: () => ({ pid: 1, on() {}, kill: (signal?: string) => void kills.push(signal) }),
      fetch: async () => ({ status: 503 }),
      now: () => (t += 400),
      sleep: async () => {},
    })
    await api.start()
    await expect(api.waitHealthy(1000)).rejects.toThrow(/healthy/i)
    expect(kills).toHaveLength(1)
  })
})

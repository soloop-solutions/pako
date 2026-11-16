import { describe, expect, it } from 'vitest'
import { ApiProcess } from './api'
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
    await expect(api.waitHealthy(1000)).rejects.toThrow(/healthy/i)
  })

  it('Api_Start_SpawnsExeWithEmptyArgsAndEnv', async () => {
    const { api, calls } = make(async () => ({ status: 200 }), () => 0)
    await api.start()
    expect(calls[0]!.cmd).toBe('C:\\Program Files\\Pako\\api\\Pako.Api.exe')
    expect(calls[0]!.args).toEqual([])
    expect(calls[0]!.env?.Desktop__Enabled).toBe('true')
  })
})

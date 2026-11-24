import { describe, expect, it } from 'vitest'
import type { NetworkInterfaceInfo } from 'node:os'
import { buildApiEnv } from './api'
import {
  ensureFirewallRule,
  FIREWALL_RULE,
  firewallRuleArgs,
  lanAddresses,
  portTakenMessage,
  TillNetworkController,
  tillStatus,
  type ExecFn,
} from './tillNetwork'

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as NetworkInterfaceInfo
const v6 = (address: string) => ({ address, family: 'IPv6', internal: false }) as NetworkInterfaceInfo

describe('lanAddresses', () => {
  it('keeps private IPv4 addresses, real adapters before virtual ones', () => {
    expect(
      lanAddresses({
        'vEthernet (WSL)': [v4('172.20.16.1')],
        Loopback: [v4('127.0.0.1', true)],
        'Wi-Fi': [v4('192.168.1.10'), v6('fe80::1')],
        Ethernet: [v4('10.0.0.5')],
        Public: [v4('84.22.50.1')],
        LinkLocal: [v4('169.254.3.3')],
      }),
    ).toEqual(['192.168.1.10', '10.0.0.5', '172.20.16.1'])
  })

  it('is empty when the PC is on no local network', () => {
    expect(lanAddresses({ Loopback: [v4('127.0.0.1', true)] })).toEqual([])
  })
})

describe('tillStatus', () => {
  it('lists a URL per address only while listening', () => {
    const on = tillStatus({ enabled: true, port: 5300, running: true, addresses: ['192.168.1.10'], error: null })
    expect(on.urls).toEqual(['http://192.168.1.10:5300'])
    const blocked = tillStatus({ enabled: true, port: 5300, running: false, addresses: ['192.168.1.10'], error: 'taken' })
    expect(blocked.urls).toEqual([])
    expect(blocked.error).toBe('taken')
  })
})

describe('buildApiEnv till port', () => {
  const base = { port: 41000, pgPort: 41001, pgPassword: 'p', jwtKey: 'k', launchSecret: 's', dataDir: '/d' }

  it('listens on loopback only while tills are off', () => {
    const env = buildApiEnv(base)
    expect(env.ASPNETCORE_URLS).toBe('http://127.0.0.1:41000')
    expect(env.Desktop__TillPort).toBe('0')
  })

  it('adds the till port on every interface when on', () => {
    const env = buildApiEnv({ ...base, tillPort: 5300 })
    expect(env.ASPNETCORE_URLS).toBe('http://127.0.0.1:41000;http://0.0.0.0:5300')
    expect(env.Desktop__TillPort).toBe('5300')
  })
})

describe('ensureFirewallRule', () => {
  const recorder = (answers: Record<string, { code: number; stdout: string }>) => {
    const calls: { file: string; args: string[] }[] = []
    const exec: ExecFn = async (file, args) => {
      calls.push({ file, args })
      return answers[file] ?? { code: 1, stdout: '' }
    }
    return { calls, exec }
  }

  it('does nothing off Windows', async () => {
    const { calls, exec } = recorder({})
    expect(await ensureFirewallRule({ platform: 'darwin', exec, apiExe: 'x' })).toEqual({ ok: true })
    expect(calls).toEqual([])
  })

  it('asks Windows only when the rule is missing', async () => {
    const present = recorder({ netsh: { code: 0, stdout: `Rule Name: ${FIREWALL_RULE}` } })
    expect(await ensureFirewallRule({ platform: 'win32', exec: present.exec, apiExe: 'C:\\P\\Pako.Api.exe' })).toEqual({ ok: true })
    expect(present.calls.map((c) => c.file)).toEqual(['netsh'])

    const missing = recorder({ netsh: { code: 1, stdout: 'No rules match' }, 'powershell.exe': { code: 0, stdout: '' } })
    expect(await ensureFirewallRule({ platform: 'win32', exec: missing.exec, apiExe: 'C:\\P\\Pako.Api.exe' })).toEqual({ ok: true })
    expect(missing.calls[1]?.args.join(' ')).toContain('-Verb RunAs')
  })

  it('reports a refused UAC prompt', async () => {
    const refused = recorder({ netsh: { code: 1, stdout: '' }, 'powershell.exe': { code: 1, stdout: '' } })
    const result = await ensureFirewallRule({ platform: 'win32', exec: refused.exec, apiExe: 'x' })
    expect(result.ok).toBe(false)
  })

  it('allows the API program on private and domain networks only', () => {
    const args = firewallRuleArgs("C:\\Users\\O'Neil\\PAKO\\Pako.Api.exe")
    expect(args).toContain('profile=private,domain')
    expect(args).toContain('program="C:\\Users\\O\'Neil\\PAKO\\Pako.Api.exe"')
    expect(args).toContain('dir=in action=allow protocol=TCP')
  })
})

describe('TillNetworkController', () => {
  const make = (over: Partial<import('./tillNetwork').TillControllerDeps> = {}) => {
    const log: string[] = []
    const deps: import('./tillNetwork').TillControllerDeps = {
      initial: { enabled: false, port: 5300 },
      startedPort: undefined,
      startError: null,
      addresses: () => ['192.168.1.10'],
      isPortFree: async () => true,
      reservedPorts: () => [41000],
      ensureFirewall: async () => ({ ok: true }),
      save: async (e, p) => void log.push(`save ${e} ${p}`),
      restartApi: async (p) => void log.push(`restart ${p}`),
      keepAwake: (on) => void log.push(`awake ${on}`),
      isBusy: () => false,
      ...over,
    }
    return { log, controller: new TillNetworkController(deps) }
  }

  it('turns tills on: firewall, API restart on the port, saved, PC kept awake', async () => {
    const { log, controller } = make()
    const result = await controller.set({ enabled: true, port: 5300 })
    expect(result.ok && result.status.urls).toEqual(['http://192.168.1.10:5300'])
    expect(log).toEqual(['awake false', 'restart 5300', 'save true 5300', 'awake true'])
  })

  it('turns tills off again', async () => {
    const { log, controller } = make({ initial: { enabled: true, port: 5300 }, startedPort: 5300 })
    const result = await controller.set({ enabled: false, port: 5300 })
    expect(result.ok && result.status.running).toBe(false)
    expect(log).toContain('restart undefined')
    expect(log.at(-1)).toBe('awake false')
  })

  it('refuses a taken port without touching the API', async () => {
    const { log, controller } = make({ isPortFree: async () => false })
    const result = await controller.set({ enabled: true, port: 5300 })
    expect(result).toEqual({ ok: false, error: portTakenMessage(5300) })
    expect(log).toEqual(['awake false'])
    expect((await make().controller.set({ enabled: true, port: 41000 })).ok).toBe(false)
  })

  it('stops when Windows refuses the firewall rule', async () => {
    const { log, controller } = make({ ensureFirewall: async () => ({ ok: false, error: 'no' }) })
    expect(await controller.set({ enabled: true, port: 5300 })).toEqual({ ok: false, error: 'no' })
    expect(log).toEqual(['awake false'])
  })

  it('puts the API back when the restart fails', async () => {
    const calls: (number | undefined)[] = []
    const { controller } = make({
      restartApi: async (p) => {
        calls.push(p)
        if (p === 5300) throw new Error('API did not become healthy in time')
      },
    })
    const result = await controller.set({ enabled: true, port: 5300 })
    expect(result).toEqual({ ok: false, error: 'API did not become healthy in time' })
    expect(calls).toEqual([5300, undefined])
    expect(controller.status().enabled).toBe(false)
  })

  it('reports a port that was taken at start-up', () => {
    const { controller } = make({ initial: { enabled: true, port: 5300 }, startError: portTakenMessage(5300) })
    expect(controller.status()).toMatchObject({ enabled: true, running: false, error: portTakenMessage(5300) })
  })
})

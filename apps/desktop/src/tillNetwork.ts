import type { NetworkInterfaceInfo } from 'node:os'
import type { TillNetworkStatus } from '@pako/shared'

// "Allow tills on this network": this PC is the shop's server. Tablets on the same network open
// http://<this PC>:<till port>, connect with a one-use link (POS setup → Devices) and work on this
// PC's one database. The API lets only till devices in through that port (TillNetworkMiddleware).

export const FIREWALL_RULE = 'PAKO tills'

const isPrivateIPv4 = (a: string) =>
  /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a)

// The PC's addresses on its local networks, the likeliest shop network first: private IPv4 only
// (a tablet can't use a public, link-local or IPv6 address here), Wi-Fi/Ethernet before virtual
// adapters (Hyper-V, VirtualBox, VPNs).
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const virtual = /vethernet|virtualbox|vmware|hyper-v|docker|wsl|tailscale|zerotier|vpn|loopback/i
  const found: { address: string; rank: number }[] = []
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal || !isPrivateIPv4(info.address)) continue
      const rank = (virtual.test(name) ? 2 : 0) + (info.address.startsWith('192.168.') ? 0 : 1)
      found.push({ address: info.address, rank })
    }
  }
  return [...new Set(found.sort((a, b) => a.rank - b.rank).map((f) => f.address))]
}

export function tillStatus(input: {
  enabled: boolean
  port: number
  running: boolean
  addresses: string[]
  error: string | null
}): TillNetworkStatus {
  return {
    enabled: input.enabled,
    port: input.port,
    running: input.running,
    urls: input.running ? input.addresses.map((a) => `http://${a}:${input.port}`) : [],
    error: input.error,
  }
}

export type ExecFn = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>

// Windows Firewall blocks the till port until a rule lets PAKO's API in. The app runs without admin
// rights, so the rule is added once through a UAC prompt; it is per program, not per port, so a
// changed port needs no new prompt. Private and domain networks only, never public Wi-Fi.
export async function hasFirewallRule(exec: ExecFn): Promise<boolean> {
  const result = await exec('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`])
  return result.code === 0 && result.stdout.includes(FIREWALL_RULE)
}

export function firewallRuleArgs(apiExe: string): string {
  return [
    'advfirewall firewall add rule',
    `name="${FIREWALL_RULE}"`,
    'dir=in action=allow protocol=TCP profile=private,domain',
    `program="${apiExe}"`,
  ].join(' ')
}

export async function addFirewallRule(exec: ExecFn, apiExe: string): Promise<boolean> {
  // Start-Process -Verb RunAs shows the UAC prompt; refusing it makes PowerShell exit non-zero.
  const argList = firewallRuleArgs(apiExe).replace(/'/g, "''")
  const result = await exec('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p = Start-Process -FilePath netsh -ArgumentList '${argList}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
  ])
  return result.code === 0
}

export async function ensureFirewallRule(deps: {
  platform: NodeJS.Platform
  exec: ExecFn
  apiExe: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (deps.platform !== 'win32') return { ok: true }
  if (await hasFirewallRule(deps.exec).catch(() => false)) return { ok: true }
  const added = await addFirewallRule(deps.exec, deps.apiExe).catch(() => false)
  return added
    ? { ok: true }
    : {
        ok: false,
        error:
          'Windows did not allow PAKO through the firewall, so tablets cannot reach this PC. ' +
          'Turn the setting on again and choose Yes when Windows asks.',
      }
}

export interface TillControllerDeps {
  initial: { enabled: boolean; port: number }
  // The port the API was started with for tills (undefined: not listening on the network).
  startedPort: number | undefined
  startError: string | null
  addresses: () => string[]
  isPortFree: (port: number) => Promise<boolean>
  reservedPorts: () => number[]
  ensureFirewall: () => Promise<{ ok: true } | { ok: false; error: string }>
  save: (enabled: boolean, port: number) => Promise<void>
  // Restarts the API listening on the till port (or not, for undefined).
  restartApi: (tillPort: number | undefined) => Promise<void>
  keepAwake: (on: boolean) => void
  isBusy: () => boolean
}

export const validTillPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535

export function portTakenMessage(port: number): string {
  return `Port ${port} is used by another program on this PC. Choose another port for the tills.`
}

export class TillNetworkController {
  private enabled: boolean
  private port: number
  private running: number | undefined
  private error: string | null

  constructor(private readonly deps: TillControllerDeps) {
    this.enabled = deps.initial.enabled
    this.port = deps.initial.port
    this.running = deps.startedPort
    this.error = deps.startError
    deps.keepAwake(this.running !== undefined)
  }

  status(): TillNetworkStatus {
    return tillStatus({
      enabled: this.enabled,
      port: this.port,
      running: this.running !== undefined,
      addresses: this.deps.addresses(),
      error: this.error,
    })
  }

  async set(settings: { enabled: boolean; port: number }): Promise<{ ok: true; status: TillNetworkStatus } | { ok: false; error: string }> {
    if (this.deps.isBusy()) return { ok: false, error: 'PAKO is restoring a backup. Try again when it has finished.' }
    if (!validTillPort(settings.port)) return { ok: false, error: 'Choose a port between 1024 and 65535.' }
    const want = settings.enabled ? settings.port : undefined
    if (want === this.running) {
      this.enabled = settings.enabled
      this.port = settings.port
      await this.deps.save(this.enabled, this.port)
      return { ok: true, status: this.status() }
    }
    if (want !== undefined) {
      if (this.deps.reservedPorts().includes(want) || !(await this.deps.isPortFree(want))) {
        return { ok: false, error: portTakenMessage(want) }
      }
      const firewall = await this.deps.ensureFirewall()
      if (!firewall.ok) return firewall
    }

    const previous = this.running
    try {
      await this.deps.restartApi(want)
    } catch (err) {
      // Put the API back the way it was; if even that fails the caller shuts PAKO down.
      await this.deps.restartApi(previous)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    this.running = want
    this.enabled = settings.enabled
    this.port = settings.port
    this.error = null
    await this.deps.save(this.enabled, this.port)
    this.deps.keepAwake(want !== undefined)
    return { ok: true, status: this.status() }
  }
}

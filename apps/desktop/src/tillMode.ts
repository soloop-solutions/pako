import { promises as nodeFs } from 'node:fs'
import nodePath from 'node:path'
import { DEFAULT_TILL_PORT } from './config'

// Desktop till mode (user request 2026-11-24: "yes build it, only the till"). On first start the
// app asks what this PC is: the *main PC* keeps the one database (and, with "Allow tills on this
// network", serves the tills), a *till* has no database at all: it opens the main PC's till in a
// window of its own, connected as a device. Several till PCs, one database, no sync.

export type StoredMode = { mode: 'main' } | { mode: 'till'; server: string }

export const MODE_FILE = 'mode.json'

export interface ModeFs {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
}

const realFs: ModeFs = {
  readFile: (p) => nodeFs.readFile(p, 'utf8'),
  writeFile: (p, d) => nodeFs.writeFile(p, d, 'utf8'),
  mkdir: async (p) => {
    await nodeFs.mkdir(p, { recursive: true })
  },
}

export async function readMode(dataDir: string, fs: ModeFs = realFs): Promise<StoredMode | null> {
  try {
    const raw = JSON.parse(await fs.readFile(nodePath.join(dataDir, MODE_FILE))) as Partial<{ mode: string; server: string }>
    if (raw.mode === 'main') return { mode: 'main' }
    if (raw.mode === 'till' && typeof raw.server === 'string') {
      const server = normalizeServer(raw.server)
      if (server) return { mode: 'till', server }
    }
    return null
  } catch {
    return null
  }
}

export async function writeMode(dataDir: string, mode: StoredMode, fs: ModeFs = realFs): Promise<void> {
  await fs.mkdir(dataDir)
  await fs.writeFile(nodePath.join(dataDir, MODE_FILE), JSON.stringify(mode, null, 2))
}

// An install from before till mode has a database and no mode file: it stays the main PC.
// Only a PC with neither is asked.
export function resolveStartMode(stored: StoredMode | null, hasDatabase: boolean): StoredMode | 'ask' {
  if (stored) return stored
  return hasDatabase ? { mode: 'main' } : 'ask'
}

// What someone types for the main PC: "192.168.1.10", "192.168.1.10:5300", "kasa-pc",
// "http://192.168.1.10:5300/". The origin, or null when it isn't an address.
export function normalizeServer(input: string, defaultPort = DEFAULT_TILL_PORT): string | null {
  const text = input.trim()
  if (!text) return null
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || url.username || url.password) return null
    if (!url.port) url.port = String(defaultPort)
    return url.origin
  } catch {
    return null
  }
}

export type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export interface FoundServer {
  url: string
  machine: string
}

// Is a PAKO main PC with tills on answering at this address? The till port's /healthz says so.
export async function probeServer(server: string, fetchFn: FetchFn, timeoutMs = 1500): Promise<FoundServer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${server}/healthz`, { signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { app?: unknown; machine?: unknown }
    if (body.app !== 'pako') return null
    return { url: server, machine: typeof body.machine === 'string' ? body.machine : '' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Every other address on this PC's /24 networks: where the main PC most likely is.
export function subnetCandidates(addresses: string[]): string[] {
  const out: string[] = []
  for (const address of addresses) {
    const parts = address.split('.')
    if (parts.length !== 4) continue
    const prefix = parts.slice(0, 3).join('.')
    for (let i = 1; i <= 254; i++) {
      const candidate = `${prefix}.${i}`
      if (candidate !== address && !out.includes(candidate)) out.push(candidate)
    }
  }
  return out
}

// Looks for main PCs on the local networks: a quick probe of each address on the till port,
// a few dozen at a time. Takes a few seconds on a shop network.
export async function discoverServers(deps: {
  addresses: string[]
  port?: number
  fetch: FetchFn
  concurrency?: number
  timeoutMs?: number
}): Promise<FoundServer[]> {
  const port = deps.port ?? DEFAULT_TILL_PORT
  const queue = subnetCandidates(deps.addresses)
  const found: FoundServer[] = []
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const hit = await probeServer(`http://${next}:${port}`, deps.fetch, deps.timeoutMs ?? 700)
      if (hit) found.push(hit)
    }
  }
  await Promise.all(Array.from({ length: deps.concurrency ?? 48 }, worker))
  return found.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }))
}

// Where the till window goes for a page it landed on: a till that isn't connected (or was
// disconnected) lands on the sign-in page, which the till port refuses anyway: send it to the
// connect page, where the short code from POS setup → Devices is typed.
export function tillRedirect(url: string, server: string): string | null {
  try {
    const u = new URL(url)
    if (u.origin !== new URL(server).origin) return null
    if (u.pathname === '/login' || u.pathname.startsWith('/login/') || u.pathname === '/') return `${server}/device/connect`
    return null
  } catch {
    return null
  }
}

// The setup page (setup.html) and its preload only answer to the local file.
export function isSetupSender(frameUrl: string | undefined): boolean {
  return !!frameUrl && frameUrl.startsWith('file://') && frameUrl.includes('setup.html')
}
